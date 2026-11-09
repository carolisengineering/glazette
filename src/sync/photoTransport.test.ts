import { afterEach, describe, expect, test, vi } from 'vitest'
import { SyncStopped } from './engine'
import { fetchPhotoTransport, PHOTO_TIMEOUT_MS } from './photoTransport'

const HASH = 'a'.repeat(64)
const SUM = 'b'.repeat(64)

function stub(status: number, body?: BodyInit | null) {
  const fn = vi
    .fn()
    .mockImplementation(async () => new Response(body ?? null, { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const json = (v: unknown) => JSON.stringify(v)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function stoppedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (error) {
    expect(error).toBeInstanceOf(SyncStopped)
    return (error as SyncStopped).reason
  }
  throw new Error('expected a SyncStopped')
}

const bytes = new Blob(['jpeg'], { type: 'image/jpeg' })

describe('missing', () => {
  test('posts the hashes and returns the missing ones', async () => {
    const fn = stub(200, json({ missing: [HASH] }))
    expect(await fetchPhotoTransport.missing([HASH, SUM])).toEqual([HASH])
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('/api/photos/missing')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body)).toEqual({ hashes: [HASH, SUM] })
  })

  test('maps statuses and bad bodies', async () => {
    stub(401)
    expect(await stoppedWith(fetchPhotoTransport.missing([HASH]))).toBe(
      'signed-out',
    )
    stub(500)
    expect(await stoppedWith(fetchPhotoTransport.missing([HASH]))).toBe('error')
    stub(200, json({ missing: 'no' }))
    expect(await stoppedWith(fetchPhotoTransport.missing([HASH]))).toBe('error')
    stub(200, 'not json')
    expect(await stoppedWith(fetchPhotoTransport.missing([HASH]))).toBe('error')
  })

  test('a network failure is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    expect(await stoppedWith(fetchPhotoTransport.missing([HASH]))).toBe(
      'offline',
    )
  })
})

describe('upload', () => {
  test('sends the bytes with their checksum', async () => {
    const fn = stub(200, json({ stored: true }))
    expect(await fetchPhotoTransport.upload(HASH, 'thumb', bytes, SUM)).toBe(
      'stored',
    )
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`/api/photos/${HASH}/thumb`)
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBe(bytes)
    expect(init.headers['content-type']).toBe('image/jpeg')
    expect(init.headers['x-content-sha256']).toBe(SUM)
  })

  test('a mismatch and a too-large photo are refused', async () => {
    stub(400, json({ code: 'PHOTO_MISMATCH', message: 'no' }))
    expect(await fetchPhotoTransport.upload(HASH, 'full', bytes, HASH)).toBe(
      'refused',
    )
    stub(413, json({ code: 'TOO_LARGE', message: 'no' }))
    expect(await fetchPhotoTransport.upload(HASH, 'full', bytes, HASH)).toBe(
      'refused',
    )
  })

  test('maps everything else', async () => {
    const up = () => fetchPhotoTransport.upload(HASH, 'full', bytes, HASH)
    stub(401)
    expect(await stoppedWith(up())).toBe('signed-out')
    stub(400, json({ code: 'BAD_PHOTO_REQUEST', message: 'no' }))
    expect(await stoppedWith(up())).toBe('error')
    stub(400, 'not json')
    expect(await stoppedWith(up())).toBe('error')
    stub(500)
    expect(await stoppedWith(up())).toBe('error')
    stub(200, json({ stored: false }))
    expect(await stoppedWith(up())).toBe('error')
    stub(200, 'not json')
    expect(await stoppedWith(up())).toBe('error')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    expect(await stoppedWith(up())).toBe('offline')
  })
})

describe('download', () => {
  test('returns the bytes', async () => {
    const fn = stub(200, 'jpeg')
    const blob = await fetchPhotoTransport.download(HASH, 'full')
    // Not instanceof: jsdom's Blob and the one a Response makes differ.
    expect(blob?.size).toBe(4)
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`/api/photos/${HASH}/full`)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  test('404 is null; everything else maps to a stop', async () => {
    stub(404, json({ code: 'NO_PHOTO', message: 'no' }))
    expect(await fetchPhotoTransport.download(HASH, 'full')).toBeNull()
    stub(401)
    expect(await stoppedWith(fetchPhotoTransport.download(HASH, 'full'))).toBe(
      'signed-out',
    )
    stub(500)
    expect(await stoppedWith(fetchPhotoTransport.download(HASH, 'full'))).toBe(
      'error',
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    expect(await stoppedWith(fetchPhotoTransport.download(HASH, 'full'))).toBe(
      'offline',
    )
  })
})

test('a request that never answers is offline after the photo timeout', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
  const result = stoppedWith(fetchPhotoTransport.download(HASH, 'full'))
  await vi.advanceTimersByTimeAsync(PHOTO_TIMEOUT_MS - 1)
  let settled = false
  void result.then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toBe('offline')
})
