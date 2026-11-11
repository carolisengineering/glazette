import { createMemoryHistory } from '@tanstack/react-router'
import { useAccount } from '../account/useAccount'
import { db } from '../db/db'
import { createAppRouter } from '../router'
import { setSinkForTests, type TelemetrySink } from './telemetry'
import { screenFor, startTelemetry, stopTelemetryForTests } from './wire'

vi.mock('web-vitals', () => ({
  onLCP: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}))

const SIGNED_OUT = { status: 'signed-out', email: undefined } as const
let calls: Array<[string, ...unknown[]]>

function fakeSink(): TelemetrySink {
  return {
    capture: (n, p) => calls.push(['capture', n, p]),
    identify: (e) => calls.push(['identify', e]),
    reset: () => calls.push(['reset']),
    captureException: (e) => calls.push(['captureException', e]),
  }
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  })
}

function start() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
  startTelemetry({ router })
  return router
}

const captures = (name: string) =>
  calls.filter((c) => c[0] === 'capture' && c[1] === name)

beforeEach(async () => {
  await db.delete()
  await db.open()
  localStorage.clear()
  useAccount.setState(SIGNED_OUT)
  calls = []
  setSinkForTests(fakeSink())
  // Idle work runs at once, except in the tests that check it waits.
  vi.stubGlobal('requestIdleCallback', (run: () => void) => run())
  setVisibility('visible')
})

afterEach(() => {
  vi.unstubAllGlobals()
  stopTelemetryForTests()
  setSinkForTests(undefined)
  vi.restoreAllMocks()
  useAccount.setState(SIGNED_OUT)
})

describe('startTelemetry', () => {
  it('identifies a signed-in device at start', () => {
    useAccount.setState({ status: 'signed-in', email: 'a@x.com' })
    start()
    expect(calls).toContainEqual(['identify', 'a@x.com'])
  })

  it('sign-out then sign-in as someone else resets in between', () => {
    useAccount.setState({ status: 'signed-in', email: 'a@x.com' })
    start()
    useAccount.setState(SIGNED_OUT)
    useAccount.setState({ status: 'signed-in', email: 'b@x.com' })
    const identity = calls.filter((c) => c[0] !== 'capture')
    expect(identity).toEqual([
      ['identify', 'a@x.com'],
      ['reset'],
      ['identify', 'b@x.com'],
    ])
  })

  it('app_opened on start and on return', () => {
    start()
    expect(captures('app_opened')[0][2]).toMatchObject({ resumed: false })
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    const opens = captures('app_opened')
    expect(opens).toHaveLength(2)
    expect(opens[1][2]).toMatchObject({ resumed: true })
  })

  it('a hidden start sends no app_opened, and the first show sends resumed false', () => {
    setVisibility('hidden')
    start()
    expect(captures('app_opened')).toHaveLength(0)
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(captures('app_opened').map((c) => c[2])).toMatchObject([
      { resumed: false },
      { resumed: true },
    ])
  })

  it('telemetry_started waits for the app to be idle', async () => {
    const idle: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (run: () => void) => idle.push(run))
    const filter = vi.spyOn(db.pieces, 'filter')
    start()
    expect(filter).not.toHaveBeenCalled()
    expect(captures('telemetry_started')).toHaveLength(0)
    for (const run of idle) run()
    await vi.waitFor(() =>
      expect(captures('telemetry_started')).toHaveLength(1),
    )
  })

  it('screen_viewed follows navigation', async () => {
    const router = start()
    await router.navigate({ to: '/piece/$id', params: { id: 'x' } })
    expect(captures('screen_viewed').map((c) => c[2])).toContainEqual({
      screen: 'piece',
    })
  })

  it('screen_viewed is sent for the initial route', async () => {
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/glazes'] }),
    )
    startTelemetry({ router })
    await router.load()
    expect(captures('screen_viewed').map((c) => c[2])).toContainEqual({
      screen: 'glazes',
    })
  })

  it('screenFor maps every route', () => {
    expect(screenFor('/')).toBe('shelf')
    expect(screenFor('/piece/abc')).toBe('piece')
    expect(screenFor('/glazes')).toBe('glazes')
    expect(screenFor('/capture')).toBe('capture')
    expect(screenFor('/nope')).toBeUndefined()
  })

  it('sends telemetry_started with pieces and first_piece_date on each start', async () => {
    await db.pieces.bulkAdd([
      {
        id: 'p1',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: 'p2',
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z',
      },
      {
        id: 'p3',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
        deletedAt: '2026-09-02T10:00:00.000Z',
      },
    ])
    start()
    await vi.waitFor(() =>
      expect(captures('telemetry_started')).toHaveLength(1),
    )
    expect(captures('telemetry_started')[0][2]).toEqual({
      pieces: 2,
      first_piece_date: '2026-10-03',
    })
    stopTelemetryForTests()
    start()
    await vi.waitFor(() =>
      expect(captures('telemetry_started')).toHaveLength(2),
    )
  })

  it('seeding survives a failed db read', () => {
    vi.spyOn(db.pieces, 'filter').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => start()).not.toThrow()
  })

  it('uncaught errors are captured', () => {
    start()
    const error = new Error('boom')
    window.dispatchEvent(new ErrorEvent('error', { error }))
    expect(calls).toContainEqual(['captureException', error])
  })
})
