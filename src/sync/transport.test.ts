import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SyncRecord } from '../../shared/syncProtocol'
import { SyncStopped } from './engine'
import { fetchTransport, SYNC_TIMEOUT_MS, timedFetch } from './transport'

function stub(status: number, body?: unknown) {
  const fn = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          body === undefined
            ? null
            : typeof body === 'string'
              ? body
              : JSON.stringify(body),
          { status, headers: { 'content-type': 'application/json' } },
        ),
    )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const record: SyncRecord = {
  kind: 'clay',
  id: 'c1',
  changedAt: '2026-01-01T00:00:00.000Z',
  data: { id: 'c1', name: 'Porcelain' },
}

const PULL_OK = { records: [record], cursor: 7, more: false }
const PUSH_OK = { rejected: [record] }

async function stoppedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (error) {
    expect(error).toBeInstanceOf(SyncStopped)
    return (error as SyncStopped).reason
  }
  throw new Error('expected the call to stop')
}

const calls = {
  pull: () => fetchTransport.pull(0),
  push: () => fetchTransport.push([record]),
}

describe.each(Object.entries(calls))('%s', (_name, call) => {
  test('a network failure is offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    expect(await stoppedWith(call())).toBe('offline')
  })

  test('401 is signed-out', async () => {
    stub(401, { code: 'NO_SESSION' })
    expect(await stoppedWith(call())).toBe('signed-out')
  })

  test('500 and 403 are errors', async () => {
    stub(500)
    expect(await stoppedWith(call())).toBe('error')
    stub(403, { code: 'BAD_ORIGIN' })
    expect(await stoppedWith(call())).toBe('error')
  })

  test('a 200 with a malformed body is an error', async () => {
    for (const body of [
      'not json',
      'null',
      { records: 'x', cursor: 1, more: false, rejected: 'x' },
      { records: [], cursor: -1, more: false },
      { records: [], cursor: 1.5, more: false },
      { records: [], cursor: 1, more: 'no' },
      {},
    ]) {
      stub(200, body)
      expect(await stoppedWith(call())).toBe('error')
    }
  })
})

test('pull asks for the page after since and returns a valid answer', async () => {
  const fn = stub(200, PULL_OK)
  expect(await fetchTransport.pull(5)).toEqual(PULL_OK)
  const [url, init] = fn.mock.calls[0]
  expect(url).toBe('/api/sync/pull?since=5')
  expect(init.method ?? 'GET').toBe('GET')
  expect(init.credentials).toBe('same-origin')
})

test('push posts the records as JSON and returns a valid answer', async () => {
  const fn = stub(200, PUSH_OK)
  expect(await fetchTransport.push([record])).toEqual(PUSH_OK)
  const [url, init] = fn.mock.calls[0]
  expect(url).toBe('/api/sync/push')
  expect(init.method).toBe('POST')
  expect(init.credentials).toBe('same-origin')
  expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  expect(JSON.parse(init.body)).toEqual({ records: [record] })
})

test('a request that never settles is offline after the timeout', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const stopped = stoppedWith(fetchTransport.pull(0))
    let settled = false
    void stopped.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await stopped).toBe('offline')
  } finally {
    vi.useRealTimers()
  }
})

describe('timedFetch', () => {
  test('hands the response to read and returns its answer', async () => {
    const fn = stub(200, 'hello')
    const answer = await timedFetch('/x', { method: 'GET' }, 1_000, (res) =>
      res.text(),
    )
    expect(answer).toBe('hello')
    expect(fn.mock.calls[0][1].credentials).toBe('same-origin')
  })

  test('a read that throws something else is an error', async () => {
    stub(200, 'hello')
    const stopped = stoppedWith(
      timedFetch('/x', {}, 1_000, async () => {
        throw new Error('bad body')
      }),
    )
    expect(await stopped).toBe('error')
  })

  test('a read that never finishes is offline after the timeout', async () => {
    vi.useFakeTimers()
    try {
      stub(200, 'hello')
      const stopped = stoppedWith(
        timedFetch('/x', {}, 1_000, () => new Promise(() => {})),
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await stopped).toBe('offline')
    } finally {
      vi.useRealTimers()
    }
  })
})

test("a record it can't use is passed on, for the engine to skip", async () => {
  const odd = { kind: 'kiln', id: 'k1' }
  stub(200, { records: [odd, record], cursor: 2, more: true })
  expect((await fetchTransport.pull(0)).records).toEqual([odd, record])
})
