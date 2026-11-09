import type { Context, Next } from 'hono'
import { randomToken, sha256Hex } from './crypto'
import type { Env } from './env'

export const SESSION_COOKIE = '__Host-session_token'
export const SESSION_TTL_MS = 365 * 86_400_000
export const REFRESH_AFTER_MS = 86_400_000

export type SessionUser = { userId: string; email: string; refreshed: boolean }

// Returns the plain token for the cookie. Only its hash is stored.
export async function createSession(
  db: D1Database,
  userId: string,
  now: number,
): Promise<string> {
  const token = randomToken()
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, refreshed_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(await sha256Hex(token), userId, now, now, now + SESSION_TTL_MS)
    .run()
  return token
}

export async function readSession(
  db: D1Database,
  token: string,
  now: number,
): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token)
  const row = await db
    .prepare(
      `SELECT s.user_id, s.refreshed_at, s.expires_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      user_id: string
      refreshed_at: number
      expires_at: number
      email: string
    }>()
  if (!row) return null
  if (row.expires_at < now) {
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
    return null
  }
  const refreshed = now - row.refreshed_at >= REFRESH_AFTER_MS
  if (refreshed) {
    await db
      .prepare(
        'UPDATE sessions SET refreshed_at = ?, expires_at = ? WHERE token_hash = ?',
      )
      .bind(now, now + SESSION_TTL_MS, tokenHash)
      .run()
  }
  return { userId: row.user_id, email: row.email, refreshed }
}

export async function endSession(db: D1Database, token: string) {
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run()
}

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/'

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_MS / 1000}`
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`
}

export function tokenFromCookie(
  header: string | null | undefined,
): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return part.slice(eq + 1).trim() || null
    }
  }
  return null
}

export type SessionVars = { userId: string }

// Only a live session gets in. Like get-session, a day-old one is renewed.
export async function requireSession(
  c: Context<{ Bindings: Env; Variables: SessionVars }>,
  next: Next,
) {
  const token = tokenFromCookie(c.req.header('cookie'))
  const session = token ? await readSession(c.env.DB, token, Date.now()) : null
  if (!token || !session) {
    return c.json(
      { code: 'NO_SESSION', message: 'You are not signed in.' },
      401,
    )
  }
  if (session.refreshed) c.header('Set-Cookie', sessionCookie(token))
  c.set('userId', session.userId)
  await next()
}
