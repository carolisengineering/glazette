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

const USERS = `SELECT DISTINCT user_id FROM records
  WHERE deleted_heard_at IS NOT NULL AND deleted_heard_at <= ?1 LIMIT ?2`

// ?1 user, ?2 cutoff, ?3 limit.
const EXPIRED = `SELECT kind, id, changed_at, json_extract(data, '$.hash') AS hash
  FROM records
  WHERE user_id = ?1 AND deleted_heard_at IS NOT NULL AND deleted_heard_at <= ?2
    AND kind IN ${KINDS}
  ORDER BY deleted_heard_at LIMIT ?3`

// The steps and layers of the expired pieces (?2), and the layers of the
// expired steps (?3), each as JSON arrays of ids.
const DEPENDENTS = `SELECT kind, id, changed_at,
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

// Unpurged photo records that hold any of the given hashes (?2).
const HOLDERS = `SELECT id, json_extract(data, '$.hash') AS hash
  FROM records
  WHERE user_id = ?1 AND kind = 'photo' AND purged_at IS NULL
    AND json_extract(data, '$.hash') IN (SELECT value FROM json_each(?2))`

// In the form of the push's upsert: one statement over the batch (?3 as JSON:
// [{k, i, c}]), each seq above every stored one. Unlike a push, a stub always
// replaces the stored row, and keeps its change time. ?2 is now.
const STUB = `INSERT INTO records (user_id, kind, id, changed_at, data, seq, purged_at, deleted_heard_at)
  SELECT ?1, json_extract(value, '$.k'), json_extract(value, '$.i'),
    json_extract(value, '$.c'),
    json_object('id', json_extract(value, '$.i'), 'deletedAt', ?2, 'purgedAt', ?2),
    (SELECT COALESCE(MAX(seq), 0) FROM records) + key + 1, ?2, NULL
  FROM json_each(?3) WHERE true
  ON CONFLICT (user_id, kind, id) DO UPDATE SET
    data = excluded.data, purged_at = excluded.purged_at,
    deleted_heard_at = NULL, seq = excluded.seq`

const FREE_FILES = `DELETE FROM photo_files
  WHERE user_id = ?1 AND hash IN (SELECT value FROM json_each(?2))`

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
  photo_id: string | null
  live: number
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
  const purge = new Map<
    string,
    { kind: string; id: string; changed_at: string }
  >()
  for (const r of expired) {
    if (r.kind !== 'photo') purge.set(keyOf(r), r)
  }
  const shownIds = new Set<string>()
  if (pieces.length > 0 || steps.length > 0) {
    const { results: dependents } = await db
      .prepare(DEPENDENTS)
      .bind(userId, ids(pieces), ids(steps))
      .all<Dependent>()
    for (const r of dependents) {
      purge.set(keyOf(r), r)
      // Only a live step of an expired piece makes its photo a candidate. A
      // tombstoned step's photo has its own clock.
      if (r.kind === 'entry' && r.live && r.photo_id) shownIds.add(r.photo_id)
    }
  }

  // 3. Photos: the expired photo tombstones, plus the photos the expired
  // pieces' live steps show.
  const candidates = new Map<string, Expiring>()
  for (const r of expired) {
    if (r.kind === 'photo') candidates.set(r.id, r)
  }
  const extra = [...shownIds].filter((id) => !candidates.has(id))
  if (extra.length > 0) {
    const { results } = await db
      .prepare(PHOTOS_BY_ID)
      .bind(userId, JSON.stringify(extra))
      .all<Expiring>()
    for (const r of results) candidates.set(r.id, r)
  }
  // A candidate survives while a live step outside this purge shows it.
  if (candidates.size > 0) {
    const { results: shownBy } = await db
      .prepare(SHOWN_BY)
      .bind(userId, JSON.stringify([...candidates.keys()]))
      .all<{ id: string; photo_id: string }>()
    for (const r of shownBy) {
      if (!purge.has(keyOf({ kind: 'entry', id: r.id })))
        candidates.delete(r.photo_id)
    }
  }
  for (const r of candidates.values()) purge.set(keyOf(r), r)
  if (purge.size === 0) return { purged: 0, filesDeleted: 0 }

  // 4. Bytes: a hash is freed unless another unpurged photo record of this
  // user, outside this purge, holds it.
  const freed = new Set<string>()
  for (const r of candidates.values()) if (r.hash) freed.add(r.hash)
  if (freed.size > 0) {
    const { results: holders } = await db
      .prepare(HOLDERS)
      .bind(userId, JSON.stringify([...freed]))
      .all<{ id: string; hash: string }>()
    for (const r of holders) {
      if (!candidates.has(r.id)) freed.delete(r.hash)
    }
  }

  // 5. Write. R2 first: if the batch then fails, the records stay expired and
  // the next run deletes the keys again, which is harmless.
  const hashes = [...freed]
  const keys = hashes.flatMap((h) => [
    `u/${userId}/full/${h}`,
    `u/${userId}/thumb/${h}`,
  ])
  for (let i = 0; i < keys.length; i += R2_DELETE_MAX_KEYS) {
    await env.PHOTOS.delete(keys.slice(i, i + R2_DELETE_MAX_KEYS))
  }
  const batch = JSON.stringify(
    [...purge.values()].map((r) => ({ k: r.kind, i: r.id, c: r.changed_at })),
  )
  const statements = [
    db.prepare(STUB).bind(userId, new Date(now).toISOString(), batch),
  ]
  if (hashes.length > 0) {
    statements.push(db.prepare(FREE_FILES).bind(userId, JSON.stringify(hashes)))
  }
  const results = await db.batch(statements)
  return {
    purged: purge.size,
    filesDeleted: results[1]?.meta.changes ?? 0,
  }
}
