import type { Context } from 'hono'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { checkCode, issueCode } from './codes'
import type { SendCode } from './email'
import type { Env } from './env'
import {
  admitCodeRequest,
  clientKey,
  isAllowed,
  overLimit,
  pruneRateLimits,
  refundCodeRequest,
} from './limits'
import {
  clearedSessionCookie,
  createSession,
  endSession,
  readSession,
  sessionCookie,
  tokenFromCookie,
} from './sessions'

const SEND_CODE_PATH = '/email-otp/send-verification-otp'
const SIGN_IN_PATH = '/sign-in/email-otp'

// Per client IP: 3 code requests and 3 sign-in tries a minute.
const IP_WINDOW_MS = 60_000
const IP_MAX = 3

type Ctx = Context<{ Bindings: Env }>

function fail(
  c: Ctx,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ code, message }, status)
}

// One "@" with something on each side, no whitespace, and no longer than an address can be.
function isPlausibleEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email)
}

// APP_ORIGIN's origin, plus any listed in EXTRA_ORIGINS (local dev only).
function trustedOrigins(env: Env): Set<string> {
  const origins = new Set([new URL(env.APP_ORIGIN).origin])
  for (const entry of (env.EXTRA_ORIGINS ?? '').split(',')) {
    if (!entry.trim()) continue
    try {
      origins.add(new URL(entry.trim()).origin)
    } catch {
      // A malformed entry trusts nothing.
    }
  }
  return origins
}

function fromTrustedOrigin(c: Ctx) {
  const origin = c.req.header('origin')
  return origin !== undefined && trustedOrigins(c.env).has(origin)
}

// The JSON object a POST carries, or null when it isn't one.
async function jsonObject(c: Ctx): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

type EmailResult = { email: string } | { error: Response }

// Reads, trims and lowercases the email, and rejects one that can't be an address.
function readEmail(c: Ctx, body: Record<string, unknown> | null): EmailResult {
  if (!body || typeof body.email !== 'string') {
    return { error: fail(c, 400, 'INVALID_BODY', 'The request is malformed.') }
  }
  const email = body.email.trim().toLowerCase()
  if (!isPlausibleEmail(email)) {
    return { error: fail(c, 400, 'INVALID_EMAIL', 'Invalid email') }
  }
  return { email }
}

async function findOrCreateUser(
  db: D1Database,
  email: string,
  now: number,
): Promise<string | null> {
  const existing = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (existing) return existing.id
  // A second guard: no account for an email that isn't on the list.
  if (!(await isAllowed(db, email))) return null
  // If a parallel sign-in created the row first, this returns its id.
  const created = await db
    .prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET email = excluded.email
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), email, now)
    .first<{ id: string }>()
  return created?.id ?? null
}

const CODE_FAILURES = {
  INVALID_OTP: [400, 'That code is not right.'],
  OTP_EXPIRED: [400, 'That code has expired.'],
  TOO_MANY_ATTEMPTS: [403, 'Too many tries for this code. Ask for a new one.'],
} as const

export function authRoutes(sendCode: (env: Env) => SendCode) {
  const routes = new Hono<{ Bindings: Env }>()

  // Every POST must come from the app itself, before anything is read or written.
  routes.use('*', async (c, next) => {
    if (c.req.method === 'POST' && !fromTrustedOrigin(c)) {
      return fail(
        c,
        403,
        'BAD_ORIGIN',
        'This request came from an untrusted site.',
      )
    }
    await next()
  })

  routes.post(SEND_CODE_PATH, async (c) => {
    const now = Date.now()
    const db = c.env.DB
    if (
      await overLimit(
        db,
        clientKey(c.req.raw, SEND_CODE_PATH),
        IP_WINDOW_MS,
        IP_MAX,
        now,
      )
    ) {
      return fail(
        c,
        429,
        'TOO_MANY_REQUESTS',
        'Too many requests. Try again in a minute.',
      )
    }
    const body = await jsonObject(c)
    const read = readEmail(c, body)
    if ('error' in read) return read.error
    const { email } = read
    // Only sign-in codes exist, so a code of any other type could never be used.
    if (body?.type !== 'sign-in') {
      return fail(c, 400, 'INVALID_TYPE', 'Invalid code type')
    }
    const slot = await admitCodeRequest(db, email)
    if (slot === 'not-open') {
      return fail(
        c,
        403,
        'NOT_OPEN',
        'Glazette sign-in is not open to this email.',
      )
    }
    if (slot === 'too-many') {
      return fail(
        c,
        429,
        'TOO_MANY_REQUESTS',
        'Too many codes for this email. Try again later.',
      )
    }
    try {
      const code = await issueCode(db, c.env.BETTER_AUTH_SECRET, email, now)
      await sendCode(c.env)(email, code)
    } catch (error) {
      console.error('Could not send the sign-in code:', error)
      // Give the slot back so an outage doesn't lock the email out.
      await refundCodeRequest(db, slot)
      return fail(
        c,
        502,
        'SEND_FAILED',
        'The code could not be sent. Try again.',
      )
    }
    return c.json({ success: true })
  })

  routes.post(SIGN_IN_PATH, async (c) => {
    const now = Date.now()
    const db = c.env.DB
    if (
      await overLimit(
        db,
        clientKey(c.req.raw, SIGN_IN_PATH),
        IP_WINDOW_MS,
        IP_MAX,
        now,
      )
    ) {
      return fail(
        c,
        429,
        'TOO_MANY_REQUESTS',
        'Too many tries. Try again in a minute.',
      )
    }
    const body = await jsonObject(c)
    const read = readEmail(c, body)
    if ('error' in read) return read.error
    const { email } = read
    const otp = body?.otp
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return fail(c, 400, 'INVALID_OTP', CODE_FAILURES.INVALID_OTP[1])
    }
    const check = await checkCode(db, c.env.BETTER_AUTH_SECRET, email, otp, now)
    if (check !== 'ok') {
      const [status, message] = CODE_FAILURES[check]
      return fail(c, status, check, message)
    }
    const userId = await findOrCreateUser(db, email, now)
    if (!userId) {
      return fail(
        c,
        403,
        'NOT_OPEN',
        'Glazette sign-in is not open to this email.',
      )
    }
    // The new cookie replaces any old one, so end its session rather than
    // leave the row for a year.
    const oldToken = tokenFromCookie(c.req.header('cookie'))
    if (oldToken) await endSession(db, oldToken)
    const token = await createSession(db, userId, now)
    await pruneRateLimits(db, now)
    c.header('Set-Cookie', sessionCookie(token))
    return c.json({ user: { email } })
  })

  routes.get('/get-session', async (c) => {
    const token = tokenFromCookie(c.req.header('cookie'))
    if (!token) return c.json(null)
    const session = await readSession(c.env.DB, token, Date.now())
    if (!session) {
      c.header('Set-Cookie', clearedSessionCookie())
      return c.json(null)
    }
    if (session.refreshed) c.header('Set-Cookie', sessionCookie(token))
    return c.json({ user: { email: session.email } })
  })

  routes.post('/sign-out', async (c) => {
    const token = tokenFromCookie(c.req.header('cookie'))
    if (token) await endSession(c.env.DB, token)
    c.header('Set-Cookie', clearedSessionCookie())
    return c.json({ success: true })
  })

  return routes
}
