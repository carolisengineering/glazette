import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  isSyncRecord,
  MAX_BODY_BYTES,
  PULL_LIMIT,
  PUSH_LIMIT,
  type PushResponse,
  type SyncRecord,
} from '../shared/syncProtocol'
import type { Env } from './env'
import { readSession, sessionCookie, tokenFromCookie } from './sessions'

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

// The stored copies of the pushed records. CROSS JOIN keeps the batch as the outer
// loop, so it is parsed once. ?2 is the batch as JSON: [{k, i, c, d}].
const STORED = `SELECT r.kind, r.id, r.changed_at, r.data
  FROM json_each(?2) j
  CROSS JOIN records r ON r.user_id = ?1
    AND r.kind = json_extract(j.value, '$.k') AND r.id = json_extract(j.value, '$.i')`

// One statement for the whole batch. Each record's seq is above every stored seq
// and follows push order, so pulls see them in the order they were pushed.
const UPSERT = `INSERT INTO records (user_id, kind, id, changed_at, data, seq)
  SELECT ?1, json_extract(value, '$.k'), json_extract(value, '$.i'),
    json_extract(value, '$.c'), json_extract(value, '$.d'),
    (SELECT COALESCE(MAX(seq), 0) FROM records) + key + 1
  FROM json_each(?2) WHERE true
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

      // Two copies of one record in a push would make the outcome ill-defined.
      const keys = new Set(records.map((r) => `${r.kind}/${r.id}`))
      if (keys.size !== records.length) return badRequest(c)

      const db = c.env.DB
      const userId = c.get('userId')
      const batch = JSON.stringify(
        records.map((r) => ({
          k: r.kind,
          i: r.id,
          c: r.changedAt,
          d: JSON.stringify(r.data),
        })),
      )
      // A constant number of statements, however many records. The read runs
      // first, so it sees the copies as they were before this push.
      const [stored] = await db.batch<StoredRow>([
        db.prepare(STORED).bind(userId, batch),
        db.prepare(UPSERT).bind(userId, batch),
      ])
      const pushed = new Map(records.map((r) => [`${r.kind}/${r.id}`, r]))
      const rejected: SyncRecord[] = []
      for (const row of stored.results) {
        if (
          row.changed_at >=
          (pushed.get(`${row.kind}/${row.id}`)?.changedAt ?? '')
        ) {
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
