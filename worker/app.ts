import { Hono } from 'hono'
import { authRoutes } from './auth'
import { resendSender, type SendCode } from './email'
import type { Env } from './env'

// Collaborators tests can swap out.
export type AppDeps = { sendCode?: SendCode }

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>().basePath('/api')
  app.get('/health', (c) => c.json({ ok: true }))
  const { sendCode } = deps
  app.route('/auth', authRoutes(sendCode ? () => sendCode : resendSender))
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
