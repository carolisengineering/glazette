// Same-origin calls to the sign-in API. Each maps the server's answer to a small
// outcome the UI can show; none of them throws on a network failure except signOutRemote.

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json()
    const code = (body as { code?: unknown } | null)?.code
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

const clean = (email: string) => email.trim().toLowerCase()

export type RequestCodeResult =
  | 'sent'
  | 'not-open'
  | 'rate-limited'
  | 'offline'
  | 'error'

export async function requestCode(email: string): Promise<RequestCodeResult> {
  let res: Response
  try {
    res = await post('/api/auth/email-otp/send-verification-otp', {
      email: clean(email),
      type: 'sign-in',
    })
  } catch {
    return 'offline'
  }
  if (res.ok) return 'sent'
  if (res.status === 429) return 'rate-limited'
  if (res.status === 403 && (await errorCode(res)) === 'NOT_OPEN')
    return 'not-open'
  return 'error'
}

export type VerifyCodeResult =
  | 'ok'
  | 'wrong'
  | 'expired'
  | 'rate-limited'
  | 'offline'
  | 'error'

export async function verifyCode(
  email: string,
  code: string,
): Promise<VerifyCodeResult> {
  let res: Response
  try {
    res = await post('/api/auth/sign-in/email-otp', {
      email: clean(email),
      otp: code,
    })
  } catch {
    return 'offline'
  }
  if (res.ok) return 'ok'
  if (res.status === 429) return 'rate-limited'
  const c = await errorCode(res)
  if (c === 'INVALID_OTP') return 'wrong'
  // A code that has used up its attempts is as good as expired.
  if (c === 'OTP_EXPIRED' || c === 'TOO_MANY_ATTEMPTS') return 'expired'
  return 'error'
}

/** The signed-in account, null when signed out (or the session is dead), 'offline' when unknown. */
export async function fetchSession(): Promise<
  { email: string } | null | 'offline'
> {
  let res: Response
  try {
    res = await fetch('/api/auth/get-session', { credentials: 'same-origin' })
  } catch {
    return 'offline'
  }
  if (res.status === 401) return null
  if (!res.ok) return 'offline'
  try {
    const body = (await res.json()) as { user?: { email?: unknown } } | null
    const email = body?.user?.email
    return typeof email === 'string' ? { email } : null
  } catch {
    return 'offline'
  }
}

/** Ends the server session. Rejects when the network call fails. */
export async function signOutRemote(): Promise<void> {
  await post('/api/auth/sign-out')
}
