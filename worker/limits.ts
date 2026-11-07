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

// Windows are a minute long, so one that started over an hour ago is long over.
const RATE_LIMIT_KEEP_MS = 60 * 60 * 1000

export async function pruneRateLimits(db: D1Database, now: number) {
  await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(now - RATE_LIMIT_KEEP_MS)
    .run()
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/

// The four bytes of a dotted IPv4 address, or null if it isn't one.
function ipv4Bytes(ip: string): number[] | null {
  const match = IPV4.exec(ip)
  if (!match) return null
  const bytes = match.slice(1).map(Number)
  return bytes.every((b) => b <= 255) ? bytes : null
}

// The groups in one side of a lowercase IPv6 address, or null if any is malformed.
// A dotted IPv4 tail counts as the last two groups.
function hexGroups(part: string): number[] | null {
  if (part === '') return []
  const pieces = part.split(':')
  const groups: number[] = []
  for (const [i, piece] of pieces.entries()) {
    if (i === pieces.length - 1 && piece.includes('.')) {
      const b = ipv4Bytes(piece)
      if (!b) return null
      groups.push((b[0] << 8) | b[1], (b[2] << 8) | b[3])
    } else if (HEX_GROUP.test(piece)) {
      groups.push(Number.parseInt(piece, 16))
    } else {
      return null
    }
  }
  return groups
}

// The eight 16-bit groups of a lowercase IPv6 address, or null if it isn't one.
function ipv6Groups(ip: string): number[] | null {
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const left = hexGroups(halves[0])
  if (!left) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  // A dotted IPv4 tail may only end the address.
  if (halves[0].includes('.')) return null
  const right = hexGroups(halves[1])
  if (!right) return null
  const missing = 8 - left.length - right.length
  if (missing < 1) return null
  return [...left, ...Array<number>(missing).fill(0), ...right]
}

// One key per client: IPv4 as is, IPv4-mapped IPv6 as its IPv4 address, and
// other IPv6 by its /64, since one ordinary connection gets a whole /64 to
// rotate through. Anything else is used as sent.
export function normalizeIp(raw: string | null): string {
  const ip = (raw ?? '').trim()
  if (!ip) return 'no-ip'
  if (ipv4Bytes(ip)) return ip
  const groups = ip.includes(':') ? ipv6Groups(ip.toLowerCase()) : null
  if (!groups) return ip
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6], groups[7]]
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`
}

// Cloudflare sets cf-connecting-ip at the edge, so clients can't spoof it.
export function clientKey(req: Request, path: string): string {
  return `${normalizeIp(req.headers.get('cf-connecting-ip'))}|${path}`
}
