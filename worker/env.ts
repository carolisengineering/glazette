export type Env = {
  DB: D1Database
  PHOTOS: R2Bucket
  BETTER_AUTH_SECRET: string
  APP_ORIGIN: string
  // Where the telemetry pass-through forwards to.
  POSTHOG_HOST: string
  RESEND_API_KEY: string
  // Comma-separated extra origins to trust. Local dev only; never set in wrangler.jsonc.
  EXTRA_ORIGINS?: string
}
