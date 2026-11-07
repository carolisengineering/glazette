import { createApp } from './app'
import { issueCode } from './codes'
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

type CallOptions = {
  body?: unknown
  // Sent as is, in place of a JSON body.
  rawBody?: string
  ip?: string
  cookie?: string
  // null sends no Origin header.
  origin?: string | null
  withEnv?: Env
}

function call(
  path: string,
  {
    body,
    rawBody,
    ip = '203.0.113.1',
    cookie,
    origin = ORIGIN,
    withEnv = env,
  }: CallOptions = {},
) {
  const headers: Record<string, string> = { 'cf-connecting-ip': ip }
  if (origin !== null) headers.Origin = origin
  const sent =
    rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  if (sent !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return app.request(
    `${ORIGIN}/api/auth${path}`,
    { method: sent === undefined ? 'GET' : 'POST', headers, body: sent },
    withEnv,
  )
}

const sendCodeTo = (email: string, ip?: string) =>
  call('/email-otp/send-verification-otp', {
    body: { email, type: 'sign-in' },
    ip,
  })

const signIn = (email: string, otp: string, ip?: string) =>
  call('/sign-in/email-otp', { body: { email, otp }, ip })

// The parts of the JSON answers these tests read.
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

  const users = await env.DB.prepare('SELECT email FROM users').all()
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
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{
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
  const row = await env.DB.prepare('SELECT expires_at FROM sessions').first<{
    expires_at: number
  }>()
  const days = ((row?.expires_at ?? 0) - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(364)
  expect(days).toBeLessThan(366)
})

const rowCount = async (
  table: 'interest' | 'code_request' | 'users' | 'sessions' | 'rate_limits',
) =>
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
  const rows = await env.DB.prepare('SELECT code_hash FROM sign_in_codes').all<{
    code_hash: string
  }>()
  expect(rows.results.length).toBeGreaterThan(0)
  for (const r of rows.results) {
    expect(r.code_hash).not.toContain(captured[0].code)
  }
  expect((await signIn(CAROL, captured[0].code)).status).toBe(200)
})

// A code issued straight into the table, so no send-code row is written.
const issueDirect = (email: string) =>
  issueCode(env.DB, env.BETTER_AUTH_SECRET, email, Date.now())

const attemptsOn = async (email: string) =>
  (
    await env.DB.prepare('SELECT attempts FROM sign_in_codes WHERE email = ?')
      .bind(email)
      .first<{ attempts: number }>()
  )?.attempts

test('a sign-in with no code issued is 400 INVALID_OTP', async () => {
  const res = await signIn(CAROL, '123456')
  expect(res.status).toBe(400)
  expect((await bodyOf(res))?.code).toBe('INVALID_OTP')
  expect(cookiesFrom(res)).not.toContain('session_token=')
})

test('a POST with no Origin, or a foreign Origin, is 403 BAD_ORIGIN and sends nothing', async () => {
  const code = await issueDirect(CAROL)
  let ip = 70
  for (const origin of ['https://evil.example', null]) {
    const requests: [string, unknown][] = [
      ['/email-otp/send-verification-otp', { email: CAROL, type: 'sign-in' }],
      ['/sign-in/email-otp', { email: CAROL, otp: code }],
      ['/sign-out', {}],
    ]
    for (const [path, body] of requests) {
      const res = await call(path, { body, origin, ip: `203.0.113.${ip++}` })
      expect(res.status).toBe(403)
      expect((await bodyOf(res))?.code).toBe('BAD_ORIGIN')
      expect(cookiesFrom(res)).not.toContain('session_token=')
    }
  }
  expect(captured).toHaveLength(0)
  expect(await rowCount('interest')).toBe(0)
  expect(await rowCount('code_request')).toBe(0)
  expect(await rowCount('users')).toBe(0)
  expect(await rowCount('sessions')).toBe(0)
  expect(await rowCount('rate_limits')).toBe(0)
  expect(await attemptsOn(CAROL)).toBe(0)
})

test('a sign-out from a foreign Origin leaves the session alive', async () => {
  await sendCodeTo(CAROL)
  const cookie = cookiesFrom(await signIn(CAROL, captured[0].code))
  const out = await call('/sign-out', {
    body: {},
    cookie,
    origin: 'https://evil.example',
  })
  expect(out.status).toBe(403)
  const session = await call('/get-session', { cookie })
  expect((await bodyOf(session))?.user?.email).toBe(CAROL)
})

test('EXTRA_ORIGINS lets a listed dev origin through', async () => {
  const devEnv: Env = {
    ...env,
    EXTRA_ORIGINS: 'https://localhost:5173, https://192.168.1.5:5173',
  }
  for (const origin of ['https://localhost:5173', 'https://192.168.1.5:5173']) {
    const res = await call('/email-otp/send-verification-otp', {
      body: { email: CAROL, type: 'sign-in' },
      origin,
      withEnv: devEnv,
    })
    expect(res.status).toBe(200)
  }
  expect(captured).toHaveLength(2)
  const foreign = await call('/email-otp/send-verification-otp', {
    body: { email: CAROL, type: 'sign-in' },
    origin: 'https://evil.example',
    withEnv: devEnv,
  })
  expect(foreign.status).toBe(403)
  expect((await bodyOf(foreign))?.code).toBe('BAD_ORIGIN')
})

test('malformed bodies are 400 and write nothing', async () => {
  const notJson = await call('/email-otp/send-verification-otp', {
    rawBody: 'email=carol@example.com',
  })
  expect(notJson.status).toBe(400)
  expect((await bodyOf(notJson))?.code).toBe('INVALID_BODY')
  const numeric = await call('/email-otp/send-verification-otp', {
    body: { email: 42, type: 'sign-in' },
  })
  expect(numeric.status).toBe(400)
  expect((await bodyOf(numeric))?.code).toBe('INVALID_BODY')

  await issueDirect(CAROL)
  for (const body of [
    { email: CAROL },
    { email: CAROL, otp: '1234567' },
    { email: CAROL, otp: '12a456' },
  ]) {
    const res = await call('/sign-in/email-otp', { body })
    expect(res.status).toBe(400)
    expect((await bodyOf(res))?.code).toBe('INVALID_OTP')
  }

  expect(captured).toHaveLength(0)
  expect(await rowCount('interest')).toBe(0)
  expect(await rowCount('code_request')).toBe(0)
  expect(await rowCount('users')).toBe(0)
  expect(await attemptsOn(CAROL)).toBe(0)
})

test('more than 3 sign-in tries from one address in a minute are 429', async () => {
  const statuses: number[] = []
  for (let i = 0; i < 4; i++) {
    statuses.push((await signIn(CAROL, '123456')).status)
  }
  expect(statuses).toEqual([400, 400, 400, 429])
  expect((await signIn(CAROL, '123456', '203.0.113.99')).status).toBe(400)
})

test('a session check a day later refreshes the cookie', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  await sendCodeTo(CAROL)
  const cookie = cookiesFrom(await signIn(CAROL, captured[0].code))

  const soon = await call('/get-session', { cookie })
  expect(soon.headers.getSetCookie()).toEqual([])

  vi.setSystemTime(Date.now() + 86_400_000 + 1000)
  const later = await call('/get-session', { cookie })
  expect((await bodyOf(later))?.user?.email).toBe(CAROL)
  const set = later.headers.getSetCookie()
  expect(set).toHaveLength(1)
  expect(set[0]).toContain('__Host-session_token=')
  expect(set[0]).not.toContain('Max-Age=0')
})

test('a dead or garbage cookie: get-session is null and sign-out is 200', async () => {
  await sendCodeTo(CAROL)
  const cookie = cookiesFrom(await signIn(CAROL, captured[0].code))
  expect((await call('/sign-out', { body: {}, cookie })).status).toBe(200)

  for (const dead of [cookie, '__Host-session_token=garbage']) {
    const session = await call('/get-session', { cookie: dead })
    expect(session.status).toBe(200)
    expect(await session.json()).toBeNull()
    expect(session.headers.getSetCookie().join()).toContain('Max-Age=0')

    const out = await call('/sign-out', { body: {}, cookie: dead })
    expect(out.status).toBe(200)
    expect(out.headers.getSetCookie().join()).toContain('Max-Age=0')
  }
})

test('a successful sign-in never returns the token in the body', async () => {
  await sendCodeTo(CAROL)
  const res = await signIn(CAROL, captured[0].code)
  expect(res.status).toBe(200)
  const token = cookiesFrom(res).split('=')[1]
  expect(token.length).toBeGreaterThan(20)
  const text = await res.text()
  expect(text).not.toContain(token)
  expect(JSON.parse(text)).toEqual({ user: { email: CAROL } })
})

test('addresses in one IPv6 /64 share the per-address limit', async () => {
  const statuses: number[] = []
  for (const ip of [
    '2001:db8:1:2::1',
    '2001:db8:1:2::2',
    '2001:DB8:1:2:0:0:0:3',
    '2001:0db8:0001:0002:ffff:ffff:ffff:ffff',
  ]) {
    statuses.push((await sendCodeTo(CAROL, ip)).status)
  }
  expect(statuses).toEqual([200, 200, 200, 429])
  expect((await sendCodeTo(CAROL, '2001:db8:1:3::1')).status).toBe(200)
})

test('a failure storing the code is a JSON error and gives the slot back', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  await env.DB.prepare('DROP TABLE sign_in_codes').run()
  const res = await sendCodeTo(CAROL)
  expect(res.status).toBe(502)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(await res.json()).toEqual({
    code: 'SEND_FAILED',
    message: expect.any(String),
  })
  expect(captured).toHaveLength(0)
  expect(await rowCount('code_request')).toBe(0)
  expect(logged).toHaveBeenCalled()
})

test('an unexpected failure is a logged JSON 500, not plain text', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  await env.DB.prepare('DROP TABLE rate_limits').run()
  for (const res of [await sendCodeTo(CAROL), await signIn(CAROL, '123456')]) {
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      code: 'SERVER_ERROR',
      message: expect.any(String),
    })
  }
  expect(logged).toHaveBeenCalledTimes(2)
})

test('signing in again ends the session the browser already had', async () => {
  await sendCodeTo(CAROL)
  const first = cookiesFrom(await signIn(CAROL, captured[0].code))
  await sendCodeTo(CAROL)
  const otp = captured[1].code

  // A failed try leaves the old session alone.
  const wrong = await call('/sign-in/email-otp', {
    body: { email: CAROL, otp: wrongCode(otp) },
    cookie: first,
  })
  expect(wrong.status).toBe(400)
  expect(
    (await bodyOf(await call('/get-session', { cookie: first })))?.user?.email,
  ).toBe(CAROL)

  const again = await call('/sign-in/email-otp', {
    body: { email: CAROL, otp },
    cookie: first,
    ip: '203.0.113.2',
  })
  expect(again.status).toBe(200)
  const second = cookiesFrom(again)
  expect(second).toContain('session_token=')
  expect(second).not.toBe(first)
  expect(await rowCount('sessions')).toBe(1)
  expect(
    await (await call('/get-session', { cookie: first })).json(),
  ).toBeNull()
  const now = await call('/get-session', { cookie: second })
  expect((await bodyOf(now))?.user?.email).toBe(CAROL)
})

test('a successful sign-in clears rate-limit windows that ended long ago', async () => {
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1), (?, ?, 1)',
  )
    .bind('old|/x', now - 2 * 60 * 60 * 1000, 'recent|/x', now - 30_000)
    .run()
  const keys = async () =>
    (
      await env.DB.prepare('SELECT key FROM rate_limits').all<{ key: string }>()
    ).results.map((r) => r.key)

  await sendCodeTo(CAROL)
  expect((await signIn(CAROL, wrongCode(captured[0].code))).status).toBe(400)
  expect(await keys()).toContain('old|/x')

  expect((await signIn(CAROL, captured[0].code)).status).toBe(200)
  const left = await keys()
  expect(left).not.toContain('old|/x')
  expect(left).toContain('recent|/x')
})

test('a sign-out with no cookie is 200 success', async () => {
  const res = await call('/sign-out', { body: {} })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true })
})
