// The daily job: what has been deleted for RETENTION_DAYS is removed for good.
// Each record becomes a stub that holds only its id and times, and a photo's
// bytes leave R2 once no other record of that user holds the same hash.
import { EXPIRING_KINDS, RETENTION_DAYS } from '../shared/syncProtocol'
import type { Env } from './env'

// Expired records per user per run. What's left over waits for the next run.
export const PURGE_LIMIT = 100
export const MAX_USERS_PER_RUN = 5
// The most keys R2 takes in one delete call.
export const R2_DELETE_MAX_KEYS = 1000

const DAY_MS = 24 * 60 * 60 * 1000
const KINDS = `(${EXPIRING_KINDS.map((k) => `'${k}'`).join(', ')})`

// An expired photo tombstone that a live step still shows stays, and stays
// expired, so the queries leave it out: otherwise it would come back first on
// every run and fill the limits. It still goes with an expired piece whose live
// step shows it (see cleanUser). `r` is the expired row.
const KEPT_PHOTO = `(r.kind = 'photo' AND EXISTS (SELECT 1 FROM records s
    WHERE s.user_id = r.user_id AND s.kind = 'entry' AND s.purged_at IS NULL
      AND json_extract(s.data, '$.deletedAt') IS NULL
      AND json_extract(s.data, '$.photoId') = r.id))`

const USERS = `SELECT DISTINCT user_id FROM records r
  WHERE deleted_heard_at IS NOT NULL AND deleted_heard_at <= ?1
    AND NOT ${KEPT_PHOTO}
  LIMIT ?2`

// ?1 user, ?2 cutoff, ?3 limit.
const EXPIRED = `SELECT kind, id, changed_at, json_extract(data, '$.hash') AS hash
  FROM records r
  WHERE user_id = ?1 AND deleted_heard_at IS NOT NULL AND deleted_heard_at <= ?2
    AND kind IN ${KINDS} AND NOT ${KEPT_PHOTO}
  ORDER BY deleted_heard_at LIMIT ?3`

// The steps and layers of the expired pieces (?2), and the layers of the
// expired steps (?3), each as JSON arrays of ids.
const DEPENDENTS = `SELECT kind, id, changed_at,
    json_extract(data, '$.pieceId') AS piece_id,
    json_extract(data, '$.entryId') AS entry_id,
    json_extract(data, '$.photoId') AS photo_id,
    json_extract(data, '$.deletedAt') IS NULL AS live
  FROM records
  WHERE user_id = ?1 AND kind IN ('entry', 'glazeApp') AND purged_at IS NULL
    AND (json_extract(data, '$.pieceId') IN (SELECT value FROM json_each(?2))
      OR (kind = 'glazeApp'
        AND json_extract(data, '$.entryId') IN (SELECT value FROM json_each(?3))))`

// The photo records with the given ids (?2).
const PHOTOS_BY_ID = `SELECT kind, id, changed_at, json_extract(data, '$.hash') AS hash
  FROM records
  WHERE user_id = ?1 AND kind = 'photo' AND purged_at IS NULL
    AND id IN (SELECT value FROM json_each(?2))`

// Live steps that show any of the given photos (?2).
const SHOWN_BY = `SELECT id, json_extract(data, '$.photoId') AS photo_id
  FROM records
  WHERE user_id = ?1 AND kind = 'entry' AND purged_at IS NULL
    AND json_extract(data, '$.deletedAt') IS NULL
    AND json_extract(data, '$.photoId') IN (SELECT value FROM json_each(?2))`

// Stubs the batch (?3 as JSON: [{k, i, c, pk, pi}]) in the form of the push's
// upsert, each seq above every stored one, keeping each record's change time.
// ?2 is now. The reads came in separate round trips, so a push may have landed
// since: a row is stubbed only if it is unchanged since the job read it (same
// change time, not purged). An expired record must still be a delete the
// server heard of; a put back clears that. A record that only came in with
// another (pk, pi) goes only if that one is a stub now, so it runs in a later
// statement of the same batch. A photo stays while a live step shows it.
// CROSS JOIN keeps the batch as the outer loop.
const STUB = `INSERT INTO records (user_id, kind, id, changed_at, data, seq, purged_at, deleted_heard_at)
  SELECT ?1, r.kind, r.id, r.changed_at,
    json_object('id', r.id, 'deletedAt', ?2, 'purgedAt', ?2),
    (SELECT COALESCE(MAX(seq), 0) FROM records) + j.key + 1, ?2, NULL
  FROM json_each(?3) j
  CROSS JOIN records r ON r.user_id = ?1
    AND r.kind = json_extract(j.value, '$.k') AND r.id = json_extract(j.value, '$.i')
  WHERE r.changed_at = json_extract(j.value, '$.c') AND r.purged_at IS NULL
    AND CASE WHEN json_extract(j.value, '$.pk') IS NULL
      THEN r.deleted_heard_at IS NOT NULL
      ELSE EXISTS (SELECT 1 FROM records p
        WHERE p.user_id = ?1 AND p.kind = json_extract(j.value, '$.pk')
          AND p.id = json_extract(j.value, '$.pi') AND p.purged_at IS NOT NULL)
      END
    AND (r.kind <> 'photo' OR r.id NOT IN (
      SELECT json_extract(s.data, '$.photoId') FROM records s
      WHERE s.user_id = ?1 AND s.kind = 'entry' AND s.purged_at IS NULL
        AND json_extract(s.data, '$.deletedAt') IS NULL
        AND json_extract(s.data, '$.photoId') IS NOT NULL))
  ON CONFLICT (user_id, kind, id) DO UPDATE SET
    data = excluded.data, purged_at = excluded.purged_at,
    deleted_heard_at = NULL, seq = excluded.seq`

// The given hashes (?2) that an unpurged photo record of the user still holds.
// Read once per statement, not once per row.
const HELD = `SELECT json_extract(data, '$.hash') FROM records
  WHERE user_id = ?1 AND kind = 'photo' AND purged_at IS NULL
    AND json_extract(data, '$.hash') IN (SELECT value FROM json_each(?2))`

// After the stubs, in the same batch: the file rows of the freed hashes that no
// photo record holds at that moment.
const FREE_FILES = `DELETE FROM photo_files
  WHERE user_id = ?1 AND hash IN (SELECT value FROM json_each(?2))
    AND hash NOT IN (${HELD})`

// After the batch: the freed hashes whose file rows are gone and that no photo
// record holds, so an upload or a push that landed since keeps its bytes.
const GONE = `SELECT j.value AS hash FROM json_each(?2) j
  WHERE NOT EXISTS (SELECT 1 FROM photo_files f
      WHERE f.user_id = ?1 AND f.hash = j.value)
    AND j.value NOT IN (${HELD})`

type Expiring = {
  kind: string
  id: string
  changed_at: string
  hash: string | null
}
type Dependent = {
  kind: string
  id: string
  changed_at: string
  piece_id: string | null
  entry_id: string | null
  photo_id: string | null
  live: number
}
// A record to stub, and the record it came in with, if it isn't expired itself.
type Purge = {
  kind: string
  id: string
  changed_at: string
  parent?: { kind: string; id: string }
}

const keyOf = (r: { kind: string; id: string }) => `${r.kind}/${r.id}`

export async function runCleanup(
  env: Env,
  now: number,
): Promise<{ purged: number; filesDeleted: number }> {
  const cutoff = new Date(now - RETENTION_DAYS * DAY_MS).toISOString()
  let users: { user_id: string }[]
  try {
    ;({ results: users } = await env.DB.prepare(USERS)
      .bind(cutoff, MAX_USERS_PER_RUN)
      .all<{ user_id: string }>())
  } catch (error) {
    console.error('Cleanup failed:', error)
    throw error
  }
  let purged = 0
  let filesDeleted = 0
  const failures: unknown[] = []
  // One user at a time, every read and write scoped to that user. One user's
  // failure doesn't hold up the others; the run still fails at the end.
  for (const { user_id } of users) {
    try {
      const done = await cleanUser(env, user_id, cutoff, now)
      purged += done.purged
      filesDeleted += done.filesDeleted
    } catch (error) {
      console.error(`Cleanup failed for user ${user_id}:`, error)
      failures.push(error)
    }
  }
  console.log(
    `Cleanup: ${purged} records purged, ${filesDeleted} photo files deleted, ${users.length} users, ${failures.length} failed`,
  )
  if (failures.length > 0) throw failures[0]
  return { purged, filesDeleted }
}

async function cleanUser(
  env: Env,
  userId: string,
  cutoff: string,
  now: number,
): Promise<{ purged: number; filesDeleted: number }> {
  const db = env.DB
  const ids = (rows: { id: string }[]) => JSON.stringify(rows.map((r) => r.id))

  // 1. Expired, oldest first.
  const { results: expired } = await db
    .prepare(EXPIRED)
    .bind(userId, cutoff, PURGE_LIMIT)
    .all<Expiring>()
  if (expired.length === 0) return { purged: 0, filesDeleted: 0 }

  // 2. What goes with them: an expired piece's steps and layers, and an
  // expired step's layers, live or not.
  const pieces = expired.filter((r) => r.kind === 'piece')
  const steps = expired.filter((r) => r.kind === 'entry')
  const purge = new Map<string, Purge>()
  for (const r of expired) {
    if (r.kind !== 'photo') purge.set(keyOf(r), r)
  }
  // Each photo a live step of an expired piece shows, and that step.
  const shownBy = new Map<string, string>()
  if (pieces.length > 0 || steps.length > 0) {
    const { results: dependents } = await db
      .prepare(DEPENDENTS)
      .bind(userId, ids(pieces), ids(steps))
      .all<Dependent>()
    const expiredPieces = new Set(pieces.map((r) => r.id))
    for (const r of dependents) {
      // Expired itself: it goes on its own.
      if (purge.has(keyOf(r))) continue
      const parent =
        r.piece_id !== null && expiredPieces.has(r.piece_id)
          ? { kind: 'piece', id: r.piece_id }
          : { kind: 'entry', id: r.entry_id ?? '' }
      purge.set(keyOf(r), { ...r, parent })
      // Only a live step of an expired piece makes its photo a candidate. A
      // tombstoned step's photo has its own clock.
      if (r.kind === 'entry' && r.live && r.photo_id)
        shownBy.set(r.photo_id, r.id)
    }
  }

  // 3. Photos: the expired photo tombstones, plus the photos the expired
  // pieces' live steps show.
  const candidates = new Map<string, Expiring & Purge>()
  for (const r of expired) {
    if (r.kind === 'photo') candidates.set(r.id, r)
  }
  const extra = [...shownBy.keys()].filter((id) => !candidates.has(id))
  if (extra.length > 0) {
    const { results } = await db
      .prepare(PHOTOS_BY_ID)
      .bind(userId, JSON.stringify(extra))
      .all<Expiring>()
    for (const r of results) {
      candidates.set(r.id, {
        ...r,
        parent: { kind: 'entry', id: shownBy.get(r.id) ?? '' },
      })
    }
  }
  // A candidate survives while a live step outside this purge shows it.
  if (candidates.size > 0) {
    const { results: shown } = await db
      .prepare(SHOWN_BY)
      .bind(userId, JSON.stringify([...candidates.keys()]))
      .all<{ id: string; photo_id: string }>()
    for (const r of shown) {
      if (!purge.has(keyOf({ kind: 'entry', id: r.id })))
        candidates.delete(r.photo_id)
    }
  }
  if (purge.size === 0 && candidates.size === 0) {
    return { purged: 0, filesDeleted: 0 }
  }

  // 4. Write. The database first: if the batch fails, nothing has changed and
  // the next run starts over. The stubs go in order, each statement after the
  // records the next one's records came in with: the expired records, then
  // what came in with them, then the photos, once the steps that show them are
  // stubs. Each candidate's hash is freed unless a photo record still holds it
  // once the stubs are in.
  const stubs = (rows: Purge[]) =>
    db.prepare(STUB).bind(
      userId,
      new Date(now).toISOString(),
      JSON.stringify(
        rows.map((r) => ({
          k: r.kind,
          i: r.id,
          c: r.changed_at,
          pk: r.parent?.kind,
          pi: r.parent?.id,
        })),
      ),
    )
  const rows = [...purge.values()]
  const statements = [
    rows.filter((r) => !r.parent),
    rows.filter((r) => r.parent),
    [...candidates.values()],
  ]
    .filter((group) => group.length > 0)
    .map(stubs)
  const stubCount = statements.length
  const freed = new Set<string>()
  for (const r of candidates.values()) if (r.hash) freed.add(r.hash)
  const hashes = JSON.stringify([...freed])
  if (freed.size > 0) {
    statements.push(db.prepare(FREE_FILES).bind(userId, hashes))
  }
  const results = await db.batch(statements)
  const purged = results
    .slice(0, stubCount)
    .reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  const filesDeleted =
    freed.size > 0 ? (results[stubCount].meta.changes ?? 0) : 0

  // 5. R2 last, and only for the hashes that are still free after the batch.
  // If a delete fails, the records are already stubs and the bytes are left
  // behind for good, which loses nothing a record still needs. The run still
  // counts it as this user's failure.
  if (freed.size === 0) return { purged, filesDeleted }
  const { results: gone } = await db
    .prepare(GONE)
    .bind(userId, hashes)
    .all<{ hash: string }>()
  const keys = gone.flatMap(({ hash }) => [
    `u/${userId}/full/${hash}`,
    `u/${userId}/thumb/${hash}`,
  ])
  for (let i = 0; i < keys.length; i += R2_DELETE_MAX_KEYS) {
    await env.PHOTOS.delete(keys.slice(i, i + R2_DELETE_MAX_KEYS))
  }
  return { purged, filesDeleted }
}
