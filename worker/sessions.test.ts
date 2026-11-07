import { randomToken, sha256Hex } from './crypto'
import type { Env } from './env'
import {
  clearedSessionCookie,
  createSession,
  endSession,
  REFRESH_AFTER_MS,
  readSession,
  SESSION_TTL_MS,
  sessionCookie,
  tokenFromCookie,
} from './sessions'
import { makeTestEnv } from './test/harness'

const EMAIL = 'carol@example.com'
const USER_ID = 'user-1'
const NOW = 1_800_000_000_000

let env: Env
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)',
  )
    .bind(USER_ID, EMAIL, NOW)
    .run()
})

afterEach(async () => {
  await dispose()
})

const expiresAt = async (token: string) =>
  (
    await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .first<{ expires_at: number }>()
  )?.expires_at

describe('sessions', () => {
  it("a new session reads back with the user's email", async () => {
    const token = await createSession(env.DB, USER_ID, NOW)
    expect(await readSession(env.DB, token, NOW)).toEqual({
      userId: USER_ID,
      email: EMAIL,
      refreshed: false,
    })
  })

  it('an unknown or garbage token is null', async () => {
    await createSession(env.DB, USER_ID, NOW)
    for (const token of ['', 'x', randomToken()]) {
      expect(await readSession(env.DB, token, NOW)).toBeNull()
    }
  })

  it('an expired session is null and its row is gone', async () => {
    const token = await createSession(env.DB, USER_ID, NOW)
    expect(
      await readSession(env.DB, token, NOW + SESSION_TTL_MS + 1),
    ).toBeNull()
    expect(await expiresAt(token)).toBeUndefined()
  })

  it('a session is refreshed at most once a day', async () => {
    const token = await createSession(env.DB, USER_ID, NOW)
    const original = await expiresAt(token)
    const early = await readSession(env.DB, token, NOW + REFRESH_AFTER_MS - 1)
    expect(early?.refreshed).toBe(false)
    expect(await expiresAt(token)).toBe(original)
    const due = await readSession(env.DB, token, NOW + REFRESH_AFTER_MS)
    expect(due?.refreshed).toBe(true)
    expect(await expiresAt(token)).toBe(NOW + REFRESH_AFTER_MS + SESSION_TTL_MS)
  })

  it('endSession removes the session, and ending an unknown token is fine', async () => {
    const token = await createSession(env.DB, USER_ID, NOW)
    await endSession(env.DB, token)
    expect(await readSession(env.DB, token, NOW)).toBeNull()
    await expect(endSession(env.DB, randomToken())).resolves.toBeUndefined()
  })

  it('the stored hash is not the token', async () => {
    const token = await createSession(env.DB, USER_ID, NOW)
    const row = await env.DB.prepare('SELECT token_hash FROM sessions').first<{
      token_hash: string
    }>()
    expect(row?.token_hash).toBe(await sha256Hex(token))
    expect(row?.token_hash).not.toContain(token)
  })

  it('the cookie is HttpOnly, Secure, SameSite=Lax, Path=/, a year long', () => {
    const cookie = sessionCookie('t')
    expect(cookie).toContain('__Host-session_token=t')
    for (const attr of [
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=31536000',
    ]) {
      expect(cookie.split('; ')).toContain(attr)
    }
    const cleared = clearedSessionCookie()
    for (const attr of [
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=0',
    ]) {
      expect(cleared.split('; ')).toContain(attr)
    }
    expect(tokenFromCookie('a=1; __Host-session_token=t; b=2')).toBe('t')
    expect(tokenFromCookie(null)).toBeNull()
    expect(tokenFromCookie('a=1')).toBeNull()
  })
})
