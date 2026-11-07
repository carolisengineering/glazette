const CODES_PER_EMAIL_PER_HOUR = 5

export async function isAllowed(db: D1Database, email: string) {
  const row = await db
    .prepare('SELECT 1 FROM allowed_email WHERE email = ?')
    .bind(email)
    .first()
  return row !== null
}

// Only allowed emails get a code, and at most 5 an hour each.
// Returns the id of the code_request row that holds the slot, so a failed send can refund it.
export async function admitCodeRequest(
  db: D1Database,
  email: string,
): Promise<'not-open' | 'too-many' | number> {
  const now = new Date()
  if (!(await isAllowed(db, email))) {
    await db
      .prepare('INSERT INTO interest (email, attempted_at) VALUES (?, ?)')
      .bind(email, now.toISOString())
      .run()
    return 'not-open'
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
  if (meta.changes === 0) return 'too-many'
  return meta.last_row_id
}

export async function refundCodeRequest(db: D1Database, slot: number) {
  await db.prepare('DELETE FROM code_request WHERE rowid = ?').bind(slot).run()
}

// A fixed window per key, counted in one upsert so parallel hits can't overshoot.
export async function overLimit(
  db: D1Database,
  key: string,
  windowMs: number,
  max: number,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END,
         count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END
       RETURNING count`,
    )
    .bind(key, now, windowMs)
    .first<{ count: number }>()
  return (row?.count ?? 0) > max
}

// Cloudflare sets cf-connecting-ip at the edge, so clients can't spoof it.
export function clientKey(req: Request, path: string): string {
  const ip = req.headers.get('cf-connecting-ip') || 'no-ip'
  return `${ip}|${path}`
}
