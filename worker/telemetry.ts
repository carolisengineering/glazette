import { Hono } from 'hono'
import type { Env } from './env'

// The only PostHog endpoints the app uses. Anything else is a 404.
const ALLOWED_PREFIXES = ['e/', 'i/v0/e/', 'batch/', 'flags/']

// Only these request headers go to PostHog, so cookies and the client's IP stay here.
const FORWARDED_HEADERS = ['content-type', 'content-encoding', 'user-agent']

// Forwards PostHog traffic from the app's own address, so blockers that match
// PostHog's domain don't drop it. The body is streamed, never read: the Workers
// Free plan allows only 10 ms of CPU.
export function telemetryRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.all('/*', async (c) => {
    const path = new URL(c.req.url).pathname.replace(/^\/api\/t\//, '')
    if (
      (c.req.method !== 'GET' && c.req.method !== 'POST') ||
      !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
    ) {
      return c.json({ error: 'not_found' }, 404)
    }

    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
      const value = c.req.header(name)
      if (value !== undefined) headers.set(name, value)
    }
    const search = new URL(c.req.url).search
    const hasBody = c.req.method === 'POST'
    const upstream = await fetch(`${c.env.POSTHOG_HOST}/${path}${search}`, {
      method: c.req.method,
      headers,
      body: hasBody ? c.req.raw.body : undefined,
      // Streaming a request body needs this.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit)

    const responseHeaders = new Headers()
    const contentType = upstream.headers.get('content-type')
    if (contentType) responseHeaders.set('content-type', contentType)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  })
  return app
}
