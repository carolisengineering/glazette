import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { SendCode } from './email'
import type { Env } from './env'

const SEND_CODE_PATH = '/email-otp/send-verification-otp'
const SIGN_IN_PATH = '/sign-in/email-otp'
const CODES_PER_EMAIL_PER_HOUR = 5
const DAY = 60 * 60 * 24

// Email-OTP routes the app doesn't use. They would send codes or set
// passwords outside the allowed-list gate, so they answer 404.
const UNUSED_PATHS = [
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
]

const notOpen = () =>
  new APIError('FORBIDDEN', {
    code: 'NOT_OPEN',
    message: 'Glazette sign-in is not open to this email.',
  })

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function isAllowed(db: D1Database, email: string) {
  const row = await db
    .prepare('SELECT 1 FROM allowed_email WHERE email = ?')
    .bind(email)
    .first()
  return row !== null
}

// Only allowed emails get a code, and at most 5 an hour each.
async function admitCodeRequest(db: D1Database, email: string) {
  const now = new Date()
  if (!(await isAllowed(db, email))) {
    await db
      .prepare('INSERT INTO interest (email, attempted_at) VALUES (?, ?)')
      .bind(email, now.toISOString())
      .run()
    throw notOpen()
  }
  // Count and insert in one statement so concurrent requests can't overshoot.
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const { meta } = await db
    .prepare(
      `INSERT INTO code_request (email, requested_at)
       SELECT ?1, ?2 WHERE (
         SELECT COUNT(*) FROM code_request WHERE email = ?1 AND requested_at > ?3
       ) < ?4`,
    )
    .bind(email, now.toISOString(), hourAgo, CODES_PER_EMAIL_PER_HOUR)
    .run()
  if (meta.changes === 0) {
    throw new APIError('TOO_MANY_REQUESTS', {
      message: 'Too many codes for this email. Try again later.',
    })
  }
}

export function createAuth(env: Env, sendCode: SendCode) {
  // Better Auth logs and swallows an error thrown while sending the code, so
  // the request would still answer 200. Note the failure against the request
  // here and turn it into an error once the endpoint has run.
  const failedSends = new WeakSet<Request>()

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.BETTER_AUTH_URL],
    disabledPaths: UNUSED_PATHS,
    session: { expiresIn: 365 * DAY, updateAge: DAY },
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: { [SEND_CODE_PATH]: { window: 60, max: 3 } },
    },
    // Cloudflare sets this header at the edge, so clients can't spoof it.
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        sendVerificationOTP: async ({ email, otp }, ctx) => {
          try {
            await sendCode(email, otp)
          } catch (error) {
            if (!ctx?.request) throw error
            ctx.context.logger.error('Could not send the sign-in code:', error)
            failedSends.add(ctx.request)
          }
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_CODE_PATH && ctx.path !== SIGN_IN_PATH) return
        // A non-string email is left for Better Auth's body validation to reject.
        if (typeof ctx.body?.email !== 'string') return
        const email = normalizeEmail(ctx.body.email)
        if (ctx.path === SEND_CODE_PATH) await admitCodeRequest(env.DB, email)
        return { context: { body: { ...ctx.body, email } } }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === SEND_CODE_PATH &&
          ctx.request &&
          failedSends.has(ctx.request)
        ) {
          throw new APIError('BAD_GATEWAY', {
            code: 'SEND_FAILED',
            message: 'The code could not be sent. Try again.',
          })
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // A second guard: no account for an email that isn't on the list.
          before: async (user) => {
            if (!(await isAllowed(env.DB, normalizeEmail(user.email))))
              throw notOpen()
          },
        },
      },
    },
  })
}
