import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureError,
  identify,
  initTelemetry,
  registerSuperProps,
  resetIdentity,
  setSinkForTests,
  type TelemetrySink,
  telemetryEnabled,
  track,
} from './telemetry'

function fakeSink() {
  const calls: unknown[][] = []
  const sink: TelemetrySink = {
    capture: (name, props) => calls.push(['capture', name, props]),
    identify: (email) => calls.push(['identify', email]),
    reset: () => calls.push(['reset']),
    register: (p) => calls.push(['register', p]),
    captureException: (error) => calls.push(['exception', error]),
  }
  return { sink, calls }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  setSinkForTests(undefined)
  vi.restoreAllMocks()
})

describe('super props', () => {
  it('registers super props in order with buffered captures', async () => {
    track('signed_in', {})
    registerSuperProps({ app_version: '2026-11-12 5c69b37' })
    const { sink, calls } = fakeSink()
    initTelemetry(async () => sink)
    await tick()
    expect(calls).toEqual([
      ['capture', 'signed_in', {}],
      ['register', { app_version: '2026-11-12 5c69b37' }],
    ])
  })

  it('re-registers super props after an identity reset', async () => {
    const { sink, calls } = fakeSink()
    initTelemetry(async () => sink)
    await tick()
    registerSuperProps({ app_version: 'v1', after_update: true })
    resetIdentity()
    expect(calls.slice(-2)).toEqual([
      ['reset'],
      ['register', { app_version: 'v1', after_update: true }],
    ])
  })
})

describe('identity reset failures', () => {
  it('still re-registers super props when the sink reset throws', async () => {
    const { sink, calls } = fakeSink()
    sink.reset = () => {
      throw new Error('reset failed')
    }
    initTelemetry(async () => sink)
    await tick()
    registerSuperProps({ app_version: 'v1', after_update: false })
    const before = calls.length
    expect(() => resetIdentity()).not.toThrow()
    expect(calls.slice(before)).toEqual([
      ['register', { app_version: 'v1', after_update: false }],
    ])
  })
})

describe('telemetryEnabled', () => {
  it('is true only in production with a key', () => {
    expect(
      telemetryEnabled({ MODE: 'production', VITE_POSTHOG_KEY: 'phc_x' }),
    ).toBe(true)
    expect(telemetryEnabled({ MODE: 'e2e', VITE_POSTHOG_KEY: 'phc_x' })).toBe(
      false,
    )
    expect(
      telemetryEnabled({ MODE: 'development', VITE_POSTHOG_KEY: 'phc_x' }),
    ).toBe(false)
    expect(telemetryEnabled({ MODE: 'production', VITE_POSTHOG_KEY: '' })).toBe(
      false,
    )
    expect(telemetryEnabled({ MODE: 'production' })).toBe(false)
  })
})

describe('telemetry sink', () => {
  it('buffers until the sink loads', async () => {
    track('glazes_added', { layers: 2 })
    track('piece_lost', { lost: true })
    const { sink, calls } = fakeSink()
    initTelemetry(async () => sink)
    await tick()
    expect(calls).toEqual([
      ['capture', 'glazes_added', { layers: 2 }],
      ['capture', 'piece_lost', { lost: true }],
    ])
  })

  it('drops past 100 buffered events', async () => {
    for (let i = 0; i < 105; i++) track('glazes_added', { layers: i })
    const { sink, calls } = fakeSink()
    initTelemetry(async () => sink)
    await tick()
    expect(calls).toHaveLength(100)
  })

  it('init survives a failing loader', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initTelemetry(async () => {
      throw new Error('blocked')
    })
    await tick()
    expect(() => track('signed_in', {})).not.toThrow()
    await tick()
  })

  it('a throwing sink never throws out of the public functions', () => {
    const boom = () => {
      throw new Error('boom')
    }
    setSinkForTests({
      capture: boom,
      identify: boom,
      reset: boom,
      register: boom,
      captureException: boom,
    })
    expect(() => track('signed_in', {})).not.toThrow()
    expect(() => identify('a@b.c')).not.toThrow()
    expect(() => resetIdentity()).not.toThrow()
    expect(() => registerSuperProps({ app_version: 'x' })).not.toThrow()
    expect(() => captureError(new Error('x'))).not.toThrow()
  })

  it('identify and reset are ordered with captures', async () => {
    track('signed_in', {})
    identify('a@b.c')
    track('signed_out', {})
    resetIdentity()
    const { sink, calls } = fakeSink()
    initTelemetry(async () => sink)
    await tick()
    expect(calls).toEqual([
      ['capture', 'signed_in', {}],
      ['identify', 'a@b.c'],
      ['capture', 'signed_out', {}],
      ['reset'],
    ])
  })
})
