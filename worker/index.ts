import { createApp } from './app'
import { runCleanup } from './cleanup'
import type { Env } from './env'

export default {
  fetch: createApp().fetch,
  // The daily Cron Trigger in wrangler.jsonc.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env, Date.now()))
  },
} satisfies ExportedHandler<Env>
