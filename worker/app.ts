import { Hono } from 'hono'
import { authRoutes } from './auth'
import { resendSender, type SendCode } from './email'
import type { Env } from './env'
import { trustedOriginOnly } from './origin'
import { photoRoutes } from './photos'
import { syncRoutes } from './sync'

// Collaborators tests can swap out.
export type AppDeps = { sendCode?: SendCode }

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>().basePath('/api')
  app.use('*', trustedOriginOnly)
  app.get('/health', (c) => c.json({ ok: true }))
  const { sendCode } = deps
  app.route('/auth', authRoutes(sendCode ? () => sendCode : resendSender))
  app.route('/sync', syncRoutes())
  app.route('/photos', photoRoutes())
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  // Anything unexpected is logged and answered as JSON, never as plain text.
  app.onError((error, c) => {
    console.error('Unexpected error:', error)
    return c.json(
      { code: 'SERVER_ERROR', message: 'Something went wrong. Try again.' },
      500,
    )
  })
  return app
}
