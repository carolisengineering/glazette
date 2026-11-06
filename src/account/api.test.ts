import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchSession, requestCode, signOutRemote, verifyCode } from './api'

function stub(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('requestCode', () => {
  test('200 is sent, and the email is trimmed and lowercased', async () => {
    const fn = stub(200, { success: true })
    expect(await requestCode('  Me@Example.COM ')).toBe('sent')
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('/api/auth/email-otp/send-verification-otp')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body)).toEqual({
      email: 'me@example.com',
      type: 'sign-in',
    })
  })
  test('403 NOT_OPEN is not-open', async () => {
    stub(403, { code: 'NOT_OPEN' })
    expect(await requestCode('a@b.co')).toBe('not-open')
  })
  test('403 without NOT_OPEN is an error', async () => {
    stub(403, { code: 'OTHER' })
    expect(await requestCode('a@b.co')).toBe('error')
  })
  test('429 is rate-limited', async () => {
    stub(429, { message: 'slow down' })
    expect(await requestCode('a@b.co')).toBe('rate-limited')
  })
  test('502 and 500 are errors', async () => {
    stub(502, { code: 'SEND_FAILED' })
    expect(await requestCode('a@b.co')).toBe('error')
    stub(500)
    expect(await requestCode('a@b.co')).toBe('error')
  })
  test('a rejected fetch is offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    expect(await requestCode('a@b.co')).toBe('offline')
  })
})

describe('verifyCode', () => {
  test('200 is ok and posts the email and code', async () => {
    const fn = stub(200, { token: 't' })
    expect(await verifyCode(' Me@Example.com', '123456')).toBe('ok')
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('/api/auth/sign-in/email-otp')
    expect(JSON.parse(init.body)).toEqual({
      email: 'me@example.com',
      otp: '123456',
    })
  })
  test('INVALID_OTP is wrong', async () => {
    stub(400, { code: 'INVALID_OTP' })
    expect(await verifyCode('a@b.co', '1')).toBe('wrong')
  })
  test('OTP_EXPIRED and TOO_MANY_ATTEMPTS are expired', async () => {
    stub(400, { code: 'OTP_EXPIRED' })
    expect(await verifyCode('a@b.co', '1')).toBe('expired')
    stub(403, { code: 'TOO_MANY_ATTEMPTS' })
    expect(await verifyCode('a@b.co', '1')).toBe('expired')
  })
  test('429 is rate-limited, 500 is error, a rejected fetch is offline', async () => {
    stub(429)
    expect(await verifyCode('a@b.co', '1')).toBe('rate-limited')
    stub(500)
    expect(await verifyCode('a@b.co', '1')).toBe('error')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await verifyCode('a@b.co', '1')).toBe('offline')
  })
})

describe('fetchSession', () => {
  test('returns the email for a live session', async () => {
    stub(200, { user: { email: 'me@example.com' }, session: {} })
    expect(await fetchSession()).toEqual({ email: 'me@example.com' })
  })
  test('null body and 401 are signed out', async () => {
    stub(200, null)
    expect(await fetchSession()).toBeNull()
    stub(401, { message: 'no' })
    expect(await fetchSession()).toBeNull()
  })
  test('offline, and server errors, are offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await fetchSession()).toBe('offline')
    stub(500)
    expect(await fetchSession()).toBe('offline')
  })
})

describe('signOutRemote', () => {
  test('posts to sign-out', async () => {
    const fn = stub(200, { success: true })
    await signOutRemote()
    expect(fn.mock.calls[0][0]).toBe('/api/auth/sign-out')
    expect(fn.mock.calls[0][1].method).toBe('POST')
  })
  test('rejects on a non-ok answer', async () => {
    stub(500, { message: 'boom' })
    await expect(signOutRemote()).rejects.toThrow()
    stub(403)
    await expect(signOutRemote()).rejects.toThrow()
  })
  test('rejects when offline so the caller can decide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    await expect(signOutRemote()).rejects.toThrow()
  })
})
