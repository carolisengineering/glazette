import { createApp } from './app'
import type { SendCode } from './email'
import type { Env } from './env'
import { makeTestEnv } from './test/harness'

const ORIGIN = 'http://localhost'
const CAROL = 'carol@example.com'

let env: Env
let dispose: () => Promise<void>
let captured: { to: string; code: string }[]
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  ;({ env, dispose } = await makeTestEnv())
  await env.DB.prepare('INSERT INTO allowed_email (email) VALUES (?)')
    .bind(CAROL)
    .run()
  captured = []
  const capture: SendCode = async (to, code) => {
    captured.push({ to, code })
  }
  app = createApp({ sendCode: capture })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await dispose()
})

type CallOptions = { body?: unknown; ip?: string; cookie?: string }

function call(
  path: string,
  { body, ip = '203.0.113.1', cookie }: CallOptions = {},
) {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    'cf-connecting-ip': ip,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return app.request(
    `${ORIGIN}/api/auth${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  )
}

const sendCodeTo = (email: string, ip?: string) =>
  call('/email-otp/send-verification-otp', {
    body: { email, type: 'sign-in' },
    ip,
  })

const signIn = (email: string, otp: string, ip?: string) =>
  call('/sign-in/email-otp', { body: { email, otp }, ip })

// The parts of Better Auth's JSON answers these tests read.
type AuthBody = { code?: string; user?: { email: string } } | null
const bodyOf = async (res: Response) => (await res.json()) as AuthBody

// The cookies a response sets, as a Cookie request header.
const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

const wrongCode = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, '0')

test('an allowed email gets a 6-digit code and can sign in', async () => {
  const sent = await sendCodeTo(CAROL)
  expect(sent.status).toBe(200)
  expect(captured).toHaveLength(1)
  expect(captured[0].code).toMatch(/^\d{6}$/)

  const signedIn = await signIn(CAROL, captured[0].code)
  expect(signedIn.status).toBe(200)
  const cookie = cookiesFrom(signedIn)
  expect(cookie).toContain('session_token=')

  const session = await call('/get-session', { cookie })
  expect(session.status).toBe(200)
  expect((await bodyOf(session))?.user?.email).toBe(CAROL)
})

test('get-session is null when signed out, and sign-out ends the session', async () => {
  const before = await call('/get-session')
  expect(before.status).toBe(200)
  expect(await before.json()).toBeNull()

  await sendCodeTo(CAROL)
  const cookie = cookiesFrom(await signIn(CAROL, captured[0].code))
  const out = await call('/sign-out', { body: {}, cookie })
  expect(out.status).toBe(200)

  const after = await call('/get-session', { cookie })
  expect(await after.json()).toBeNull()
})

test('mixed case and spaces match the allowed list and the same account', async () => {
  expect((await sendCodeTo('  Carol@Example.COM ')).status).toBe(200)
  expect(captured[0].to).toBe(CAROL)
  const first = await signIn(' CAROL@example.com', captured[0].code)
  expect(first.status).toBe(200)
  expect((await bodyOf(first))?.user?.email).toBe(CAROL)

  await sendCodeTo(CAROL)
  expect((await signIn(CAROL, captured[1].code)).status).toBe(200)

  const users = await env.DB.prepare('SELECT email FROM user').all()
  expect(users.results).toEqual([{ email: CAROL }])
})

test('a turned-away email gets 403 NOT_OPEN, no code, and an interest row', async () => {
  const res = await sendCodeTo(' Someone@Else.com')
  expect(res.status).toBe(403)
  const body = await bodyOf(res)
  expect(body?.code).toBe('NOT_OPEN')
  expect(captured).toHaveLength(0)

  const rows = await env.DB.prepare(
    'SELECT email, attempted_at FROM interest',
  ).all<{
    email: string
    attempted_at: string
  }>()
  expect(rows.results.map((r) => r.email)).toEqual(['someone@else.com'])
  expect(Number.isNaN(Date.parse(rows.results[0].attempted_at))).toBe(false)
})

test('a wrong code is rejected and does not sign in', async () => {
  await sendCodeTo(CAROL)
  const res = await signIn(CAROL, wrongCode(captured[0].code))
  expect(res.status).toBe(400)
  expect((await bodyOf(res))?.code).toBe('INVALID_OTP')
  expect(cookiesFrom(res)).not.toContain('session_token=')
})

test('a code expires after 5 minutes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  await sendCodeTo(CAROL)
  vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000)
  const res = await signIn(CAROL, captured[0].code)
  expect(res.status).toBe(400)
  expect((await bodyOf(res))?.code).toBe('OTP_EXPIRED')
})

test('after 3 wrong tries even the right code is refused', async () => {
  await sendCodeTo(CAROL)
  const { code } = captured[0]
  for (const ip of ['203.0.113.11', '203.0.113.12', '203.0.113.13']) {
    expect((await signIn(CAROL, wrongCode(code), ip)).status).toBe(400)
  }
  const res = await signIn(CAROL, code, '203.0.113.14')
  expect(res.status).toBe(403)
  expect((await bodyOf(res))?.code).toBe('TOO_MANY_ATTEMPTS')
  expect(cookiesFrom(res)).not.toContain('session_token=')
})

test('more than 5 code requests for one email in an hour are refused with 429', async () => {
  const statuses: number[] = []
  for (let i = 1; i <= 6; i++) {
    statuses.push((await sendCodeTo(CAROL, `203.0.113.${20 + i}`)).status)
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  expect(captured).toHaveLength(5)
})

test('more than 3 code requests from one address in a minute are refused with 429', async () => {
  const statuses: number[] = []
  for (let i = 0; i < 4; i++) statuses.push((await sendCodeTo(CAROL)).status)
  expect(statuses).toEqual([200, 200, 200, 429])
  expect((await sendCodeTo(CAROL, '203.0.113.99')).status).toBe(200)
})

test('a failed email send is an error, not a success', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  app = createApp({
    sendCode: async () => {
      throw new Error('Resend is down')
    },
  })
  const res = await sendCodeTo(CAROL)
  expect(res.status).toBeGreaterThanOrEqual(500)
  expect((await bodyOf(res))?.code).toBe('SEND_FAILED')
  expect(logged).toHaveBeenCalledWith(
    expect.stringContaining('Could not send the sign-in code'),
    expect.objectContaining({ message: 'Resend is down' }),
  )
})

test('an email taken off the list before signing in cannot create an account', async () => {
  await sendCodeTo(CAROL)
  await env.DB.prepare('DELETE FROM allowed_email').run()
  const res = await signIn(CAROL, captured[0].code)
  expect(res.status).toBe(403)
  expect((await bodyOf(res))?.code).toBe('NOT_OPEN')
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first<{
    n: number
  }>()
  expect(users?.n).toBe(0)
})

test('code routes other than sign-in are switched off', async () => {
  const res = await call('/forget-password/email-otp', {
    body: { email: CAROL },
  })
  expect(res.status).toBe(404)
  expect(captured).toHaveLength(0)
})

test('sessions last 365 days', async () => {
  await sendCodeTo(CAROL)
  await signIn(CAROL, captured[0].code)
  const row = await env.DB.prepare('SELECT expiresAt FROM session').first<{
    expiresAt: string
  }>()
  const days =
    (new Date(row?.expiresAt ?? 0).getTime() - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(364)
  expect(days).toBeLessThan(366)
})

const rowCount = async (table: 'interest' | 'code_request') =>
  (
    await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
      n: number
    }>()
  )?.n

test.each([
  'not an email',
  'a@@b.com',
  'a b@c.com',
  '@c.com',
  'a@',
  `${'a'.repeat(250)}@b.com`,
])('a junk email (%s) is a 400 and writes nothing', async (email) => {
  const res = await sendCodeTo(email)
  expect(res.status).toBe(400)
  expect((await bodyOf(res))?.code).toBe('INVALID_EMAIL')
  expect(captured).toHaveLength(0)
  expect(await rowCount('interest')).toBe(0)
  expect(await rowCount('code_request')).toBe(0)
})

test('a request for any type but sign-in is a 400 and uses no slot', async () => {
  for (const type of [
    'email-verification',
    'forget-password',
    'change-email',
  ]) {
    const res = await call('/email-otp/send-verification-otp', {
      body: { email: CAROL, type },
    })
    expect(res.status).toBe(400)
  }
  expect(captured).toHaveLength(0)
  expect(await rowCount('interest')).toBe(0)
  expect(await rowCount('code_request')).toBe(0)
})

test('failed sends are refunded, so an outage does not lock the email out', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const working = app
  app = createApp({
    sendCode: async () => {
      throw new Error('Resend is down')
    },
  })
  for (let i = 1; i <= 5; i++) {
    const res = await sendCodeTo(CAROL, `203.0.113.${40 + i}`)
    expect(res.status).toBe(502)
    expect((await bodyOf(res))?.code).toBe('SEND_FAILED')
  }
  expect(await rowCount('code_request')).toBe(0)
  app = working
  expect((await sendCodeTo(CAROL, '203.0.113.60')).status).toBe(200)
  expect(captured).toHaveLength(1)
})

test('codes are not stored in plain text', async () => {
  await sendCodeTo(CAROL)
  const rows = await env.DB.prepare('SELECT value FROM verification').all<{
    value: string
  }>()
  expect(rows.results.length).toBeGreaterThan(0)
  for (const r of rows.results) expect(r.value).not.toContain(captured[0].code)
  expect((await signIn(CAROL, captured[0].code)).status).toBe(200)
})
