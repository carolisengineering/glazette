import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  isSyncRecord,
  PULL_LIMIT,
  PUSH_LIMIT,
  type PushResponse,
  type SyncRecord,
} from '../shared/syncProtocol'
import type { Env } from './env'
import { readSession, sessionCookie, tokenFromCookie } from './sessions'

const MAX_BODY_BYTES = 1024 * 1024

type Vars = { userId: string }
type Ctx = Context<{ Bindings: Env; Variables: Vars }>

function fail(
  c: Ctx,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ code, message }, status)
}

const badRequest = (c: Ctx) =>
  fail(c, 400, 'BAD_SYNC_REQUEST', 'The sync request is malformed.')

// Only a live session gets in. Like get-session, a day-old one is renewed.
async function requireSession(c: Ctx, next: Next) {
  const token = tokenFromCookie(c.req.header('cookie'))
  const session = token ? await readSession(c.env.DB, token, Date.now()) : null
  if (!token || !session) {
    return fail(c, 401, 'NO_SESSION', 'You are not signed in.')
  }
  if (session.refreshed) c.header('Set-Cookie', sessionCookie(token))
  c.set('userId', session.userId)
  await next()
}

const UPSERT = `INSERT INTO records (user_id, kind, id, changed_at, data, seq)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records))
  ON CONFLICT (user_id, kind, id) DO UPDATE SET
    changed_at = excluded.changed_at, data = excluded.data, seq = excluded.seq
  WHERE excluded.changed_at > records.changed_at`

type StoredRow = {
  kind: string
  id: string
  changed_at: string
  data: string
}

export function syncRoutes() {
  const routes = new Hono<{ Bindings: Env; Variables: Vars }>()

  routes.use('*', requireSession)

  routes.post(
    '/push',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          { code: 'TOO_LARGE', message: 'That sync request is too large.' },
          413,
        ),
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return badRequest(c)
      }
      const records = (body as { records?: unknown } | null)?.records
      if (
        !Array.isArray(records) ||
        records.length > PUSH_LIMIT ||
        !records.every(isSyncRecord)
      ) {
        return badRequest(c)
      }
      if (records.length === 0) return c.json({ rejected: [] })

      const db = c.env.DB
      const userId = c.get('userId')
      const results = await db.batch(
        records.map((r) =>
          db
            .prepare(UPSERT)
            .bind(userId, r.kind, r.id, r.changedAt, JSON.stringify(r.data)),
        ),
      )
      const refused = records.filter((_, i) => results[i].meta.changes === 0)
      if (refused.length === 0) return c.json({ rejected: [] })

      // The server's current copy of each record it didn't take.
      const copies = await db.batch<StoredRow>(
        refused.map((r) =>
          db
            .prepare(
              'SELECT kind, id, changed_at, data FROM records WHERE user_id = ? AND kind = ? AND id = ?',
            )
            .bind(userId, r.kind, r.id),
        ),
      )
      const rejected: SyncRecord[] = []
      for (const { results: rows } of copies) {
        for (const row of rows) {
          rejected.push({
            kind: row.kind as SyncRecord['kind'],
            id: row.id,
            changedAt: row.changed_at,
            data: JSON.parse(row.data) as Record<string, unknown>,
          })
        }
      }
      return c.json({ rejected } satisfies PushResponse)
    },
  )

  routes.get('/pull', async (c) => {
    const raw = c.req.query('since')
    if (raw === undefined || !/^\d{1,15}$/.test(raw)) return badRequest(c)
    const since = Number(raw)
    const { results } = await c.env.DB.prepare(
      `SELECT kind, id, changed_at, data, seq FROM records
       WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    )
      .bind(c.get('userId'), since, PULL_LIMIT)
      .all<StoredRow & { seq: number }>()
    // Built by hand so each stored data string goes out as is, never parsed.
    const items = results.map(
      (r) =>
        `{"kind":${JSON.stringify(r.kind)},"id":${JSON.stringify(r.id)},"changedAt":${JSON.stringify(r.changed_at)},"data":${r.data}}`,
    )
    const cursor = results.length > 0 ? results[results.length - 1].seq : since
    const more = results.length === PULL_LIMIT
    return c.body(
      `{"records":[${items.join(',')}],"cursor":${cursor},"more":${more}}`,
      200,
      { 'content-type': 'application/json' },
    )
  })

  return routes
}
