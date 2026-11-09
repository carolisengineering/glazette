import type { Context, Next } from 'hono'
import type { Env } from './env'

// The trusted origins for the last settings seen, so each request doesn't parse them again.
let originsCache: { from: string; origins: Set<string> } | undefined

function trustedOrigins(env: Env): Set<string> {
  const from = `${env.APP_ORIGIN}\n${env.EXTRA_ORIGINS ?? ''}`
  if (originsCache?.from !== from) {
    originsCache = { from, origins: parseOrigins(env) }
  }
  return originsCache.origins
}

// APP_ORIGIN's origin, plus any listed in EXTRA_ORIGINS (local dev only).
function parseOrigins(env: Env): Set<string> {
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

function fromTrustedOrigin(c: Context<{ Bindings: Env }>) {
  const origin = c.req.header('origin')
  return origin !== undefined && trustedOrigins(c.env).has(origin)
}

// Every request that isn't a GET or HEAD must come from the app itself, before
// anything is read or written.
export async function trustedOriginOnly(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  if (
    c.req.method !== 'GET' &&
    c.req.method !== 'HEAD' &&
    !fromTrustedOrigin(c)
  ) {
    return c.json(
      {
        code: 'BAD_ORIGIN',
        message: 'This request came from an untrusted site.',
      },
      403,
    )
  }
  await next()
}
