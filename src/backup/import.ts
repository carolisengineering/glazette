import type { EntityTable, IDType } from 'dexie'
import { strFromU8, type Unzipped, unzipSync } from 'fflate'
import { PHOTO_HASH } from '../../shared/photoProtocol'
import { EPOCH } from '../../shared/syncProtocol'
import { db, newId, UNDELETE_PHOTO } from '../db/db'
import {
  isClayRow,
  isEntryRow,
  isGlazeRow,
  isLayerRow,
  isObject,
  isPieceRow,
  isRow,
  isSettingsRow,
  nameKey,
  withValidColor,
} from '../db/rowChecks'
import type { Photo, PhotoBytes, Settings } from '../db/types'
import { hashesHeld } from '../photos/bytes'
import { changedAt } from '../sync/records'
import { withoutDeviceFields } from '../sync/track'
import type { ReadBytes } from './export'
import {
  BACKUP_JSON_PATH,
  BACKUP_VERSION,
  type BackupJson,
  type PhotoMeta,
  photoPath,
  thumbPath,
} from './format'

/** The file isn't a zip, has no glazette.json, or is from an unknown version. */
export class NotABackupError extends Error {
  constructor() {
    super('This is not a Glazette backup')
    this.name = 'NotABackupError'
  }
}

/** The backup was made by a newer version of the app than this one. */
export class NewerBackupError extends Error {
  constructor() {
    super('This backup is from a newer version of Glazette')
    this.name = 'NewerBackupError'
  }
}

export interface ImportResult {
  /** New rows across all tables. */
  added: number
  /** Rows replaced by a newer copy, or newly tombstoned. */
  updated: number
  /** Pieces added, replaced or newly deleted: what the restore message counts. */
  pieces: number
}

const readFileBytes: ReadBytes = async (file) =>
  new Uint8Array(await file.arrayBuffer())

/**
 * Merges a backup zip into the database. Everything is read and checked before
 * the single write transaction starts, so a bad file or a failed write leaves
 * the database as it was.
 */
export async function importZip(
  file: Blob,
  readBytes: ReadBytes = readFileBytes,
): Promise<ImportResult> {
  const { json, files } = unpack(await readBytes(file))
  return db.transaction(
    'rw',
    [
      db.pieces,
      db.entries,
      db.glazeApps,
      db.glazes,
      db.clays,
      db.settings,
      db.photos,
      db.photoBytes,
    ],
    // Must be an async function: Dexie keeps the transaction across native
    // awaits only when the scope function itself is async.
    async () => await merge(json, files),
  )
}

function unpack(bytes: Uint8Array): { json: BackupJson; files: Unzipped } {
  // fflate reads from the central directory at the end and can open a file
  // whose start isn't a zip, so check the "PK" signature first.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new NotABackupError()
  let files: Unzipped
  let json: unknown
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.name === BACKUP_JSON_PATH ||
        f.name.startsWith('photos/') ||
        f.name.startsWith('thumbs/'),
    })
    json = JSON.parse(strFromU8(files[BACKUP_JSON_PATH]))
  } catch {
    // Not a zip, no glazette.json, or JSON that won't parse.
    throw new NotABackupError()
  }
  if (!isBackup(json)) throw new NotABackupError()
  if (json.dbVersion !== undefined && json.dbVersion > db.verno) {
    throw new NewerBackupError()
  }
  return { json, files }
}

const areRows = (v: unknown, check: (row: unknown) => boolean) =>
  Array.isArray(v) && v.every(check)

function isBackup(json: unknown): json is BackupJson {
  return (
    isObject(json) &&
    json.version === BACKUP_VERSION &&
    (json.dbVersion === undefined || typeof json.dbVersion === 'number') &&
    areRows(json.pieces, isPieceRow) &&
    areRows(json.entries, isEntryRow) &&
    areRows(json.glazeApps, isLayerRow) &&
    areRows(json.glazes, isGlazeRow) &&
    areRows(json.clays, isClayRow) &&
    areRows(json.photos, (row) =>
      isRow(row, ['hash'], (r) => PHOTO_HASH.test(r.hash as string)),
    ) &&
    (json.settings == null || isSettingsRow(json.settings))
  )
}

async function merge(json: BackupJson, files: Unzipped): Promise<ImportResult> {
  const count: ImportResult = { added: 0, updated: 0, pieces: 0 }

  const clays = await matchByName(db.clays, json.clays)
  await mergeKeepingLocal(db.clays, clays.rows, count)
  const glazes = await matchByName(db.glazes, json.glazes.map(withValidColor))
  await mergeKeepingLocal(db.glazes, glazes.rows, count)

  await mergePieces(
    json.pieces.map((p) => {
      const clayId = p.clayId && clays.idMap.get(p.clayId)
      return clayId ? { ...p, clayId } : p
    }),
    count,
  )
  const photos = await mergePhotos(json.photos, files, count)

  const entries = json.entries.map((e) => {
    const photoId = e.photoId && photos.idMap.get(e.photoId)
    return photoId ? { ...e, photoId } : e
  })
  const releases = await photosOfTombstonedSteps(entries)
  for (const [id, deletedAt] of photos.tombstones) releases.set(id, deletedAt)
  const addedEntries = await mergeKeepingLocal(db.entries, entries, count)
  await reviveReusedPhotos(addedEntries, photos.matched, count)
  await releaseUnusedPhotos(releases)

  // Layers belong to their step: they come in only with a step added here,
  // so layers the app removed from an existing step never come back.
  const addedEntryIds = new Set(addedEntries.map((e) => e.id))
  await mergeKeepingLocal(
    db.glazeApps,
    json.glazeApps
      .filter((a) => addedEntryIds.has(a.entryId))
      .map((a) => {
        const glazeId = glazes.idMap.get(a.glazeId)
        return glazeId ? { ...a, glazeId } : a
      }),
    count,
  )
  await mergeSettings(json.settings, clays.idMap, count)
  return count
}

/**
 * Photos of local live steps that an incoming tombstone is about to delete,
 * with the tombstone's date. Read before the steps are written.
 */
async function photosOfTombstonedSteps(
  incoming: BackupJson['entries'],
): Promise<Map<string, string>> {
  const rows = uniqueById(incoming)
  const local = await db.entries.bulkGet(rows.map((r) => r.id))
  const photos = new Map<string, string>()
  rows.forEach((row, i) => {
    const mine = local[i]
    if (row.deletedAt && mine && !mine.deletedAt && mine.photoId) {
      photos.set(mine.photoId, row.deletedAt)
    }
  })
  return photos
}

/**
 * As removePhoto does in the app: a photo is deleted only when no live step
 * shows it, because identical photos share one row. Runs after the steps are
 * written, so it sees the merged state.
 */
async function releaseUnusedPhotos(candidates: Map<string, string>) {
  if (candidates.size === 0) return
  const used = new Set<string>()
  await db.entries
    .filter((e) => !e.deletedAt && e.photoId !== undefined)
    .each((e) => used.add(e.photoId as string))
  const ids = [...candidates.keys()]
  const photos = await db.photos.bulkGet(ids)
  const changes = ids.flatMap((id, i) =>
    photos[i] && !photos[i].deletedAt && !used.has(id)
      ? [{ key: id, changes: { deletedAt: candidates.get(id) } }]
      : [],
  )
  if (changes.length > 0) await db.photos.bulkUpdate(changes)
}

const uniqueById = <T extends { id: string }>(rows: T[]): T[] => [
  ...new Map(rows.map((r) => [r.id, r])).values(),
]

/**
 * Clays and glazes match by id, then by live name ignoring case, as the app
 * does when one is typed in. A live incoming row with a new id whose name
 * matches a live row here (or one earlier in this import) isn't added: its id
 * maps to that row. Returns the id map and the rows left for the id merge.
 */
async function matchByName<
  T extends { id: string; name: string; deletedAt?: string },
>(table: EntityTable<T, 'id'>, incoming: T[]) {
  const idMap = new Map<string, string>()
  const rows = uniqueById(incoming)
  const known = new Set(
    (await table.bulkGet(rows.map((r) => r.id) as IDType<T, 'id'>[]))
      .filter((r) => r !== undefined)
      .map((r) => r.id),
  )
  const byName = new Map(
    (await table.filter((r) => !r.deletedAt).toArray()).map((r) => [
      nameKey(r.name),
      r.id,
    ]),
  )
  const left: T[] = []
  for (const row of rows) {
    if (known.has(row.id) || row.deletedAt) {
      left.push(row)
      continue
    }
    const key = nameKey(row.name)
    const match = byName.get(key)
    if (match) {
      idMap.set(row.id, match)
      continue
    }
    byName.set(key, row.id)
    left.push(row)
  }
  return { idMap, rows: left }
}

/**
 * For every table but pieces: rows aren't compared by change time. Unknown ids
 * are added. Known ids keep the local row, except that an incoming tombstone
 * is applied to a live row: deletions spread, edits never overwrite. Returns
 * the added rows.
 *
 * An added row keeps the backup's change time (1970 when the backup has none),
 * so a stale backup can't outrank newer copies at sync. A tombstone applied
 * here is a change made now, and the change tracker stamps it so.
 */
async function mergeKeepingLocal<
  T extends { id: string; deletedAt?: string; updatedAt?: string },
>(
  table: EntityTable<T, 'id'>,
  incoming: T[],
  count: ImportResult,
): Promise<T[]> {
  const rows = uniqueById(incoming)
  const local = await table.bulkGet(rows.map((r) => r.id) as IDType<T, 'id'>[])
  const added: T[] = []
  const writes: T[] = []
  rows.forEach((row, i) => {
    const mine = local[i]
    if (!mine) {
      const restored = { ...row, updatedAt: row.updatedAt ?? EPOCH }
      added.push(restored)
      writes.push(restored)
    } else if (row.deletedAt && !mine.deletedAt) {
      writes.push({ ...mine, deletedAt: row.deletedAt })
      count.updated++
    }
  })
  count.added += added.length
  if (writes.length > 0) await table.bulkPut(writes)
  return added
}

/** A known piece is replaced only when the incoming copy changed later (a delete included). */
async function mergePieces(
  incoming: BackupJson['pieces'],
  count: ImportResult,
) {
  const rows = uniqueById(incoming)
  const local = await db.pieces.bulkGet(rows.map((r) => r.id))
  const writes = rows.filter((row, i) => {
    const mine = local[i]
    if (!mine) {
      count.added++
      count.pieces++
      return true
    }
    // The later of updatedAt and deletedAt: the generic soft delete sets only deletedAt.
    if (changedAt(row) > changedAt(mine)) {
      count.updated++
      count.pieces++
      return true
    }
    return false
  })
  if (writes.length > 0) await db.pieces.bulkPut(writes)
}

const jpeg = (bytes: Uint8Array) =>
  new Blob([bytes as BlobPart], { type: 'image/jpeg' })

/**
 * Photos match by hash. A hash already stored here maps the incoming id to the
 * local one. A new hash is added with its bytes from the zip. When the zip
 * lacks the image (the backup was made before it downloaded), the details are
 * added alone and wait to download; the photo shows a placeholder until then.
 * Bytes from the zip go to the bytes table unless it already holds that hash.
 * Returns the incoming-to-local id map and the ids of photos already stored
 * here that matched by hash.
 */
async function mergePhotos(
  allIncoming: PhotoMeta[],
  files: Unzipped,
  count: ImportResult,
) {
  const idMap = new Map<string, string>()
  const matched = new Set<string>()
  // Local photo id -> date of an incoming tombstone for the same hash.
  const tombstones = new Map<string, string>()
  // A merged duplicate is ignored here: it must not reach `tombstones`, or
  // it would delete the live photo of the same hash.
  const incoming = allIncoming.filter((p) => !p.mergedInto)
  if (incoming.length === 0) return { idMap, matched, tombstones }

  const localByHash = new Map<string, Photo>()
  // A local merged duplicate is never matched, nor a purged row: the server
  // keeps only its stub.
  const sameHash = (
    await db.photos
      .where('hash')
      .anyOf(incoming.map((p) => p.hash))
      .toArray()
  ).filter((p) => !p.mergedInto && !p.purgedAt)
  for (const p of sameHash) {
    const seen = localByHash.get(p.hash)
    // Prefer a live row when duplicates exist.
    if (!seen || (seen.deletedAt && !p.deletedAt)) localByHash.set(p.hash, p)
  }
  const usedIds = new Set(
    (await db.photos.bulkGet(incoming.map((p) => p.id)))
      .filter((p) => p !== undefined)
      .map((p) => p.id),
  )

  const held = await hashesHeld(
    db,
    incoming.map((p) => p.hash),
  )
  const newBytes: PhotoBytes[] = []
  // A missing thumbnail falls back to the full image rather than losing the photo.
  const keepFromZip = (hash: string, full: Uint8Array) => {
    if (held.has(hash)) return
    held.add(hash)
    const thumb = bytesInZip(thumbPath(hash)) ?? full
    newBytes.push({ hash, blob: jpeg(full), thumb: jpeg(thumb) })
  }

  // An empty file is as good as none: it would never match its hash.
  const bytesInZip = (path: string) =>
    files[path]?.length ? files[path] : undefined

  const writes: Photo[] = []
  // Local rows that had only details, and now wait to upload what the zip gave.
  const fills: { key: string; changes: Partial<Photo> }[] = []
  for (const meta of incoming) {
    const local = localByHash.get(meta.hash)
    if (local) {
      const full = bytesInZip(photoPath(meta.hash))
      if (!local.blob && !held.has(meta.hash) && full) {
        keepFromZip(meta.hash, full)
        fills.push({
          key: local.id,
          changes: { needsUpload: 1, needsDownload: undefined },
        })
      }
      if (local.id !== meta.id) idMap.set(meta.id, local.id)
      // Only photos stored before this import; a duplicate hash in the zip
      // just maps to the copy added a moment ago.
      if (!writes.includes(local)) matched.add(local.id)
      if (meta.deletedAt && !local.deletedAt) {
        tombstones.set(local.id, meta.deletedAt)
      }
      continue
    }
    const full = bytesInZip(photoPath(meta.hash))
    if (full) keepFromZip(meta.hash, full)
    // An id taken by a different photo gets a fresh one, never an overwrite.
    const id = usedIds.has(meta.id) ? newId() : meta.id
    if (id !== meta.id) idMap.set(meta.id, id)
    usedIds.add(id)
    // Keeps the backup's change time (1970 when it has none), as other rows
    // do. The change tracker marks it dirty. A backup's JSON shouldn't name
    // bytes, but a row must never seem to hold some it doesn't.
    const row: Photo = {
      ...(withoutDeviceFields(meta) as Photo),
      id,
      updatedAt: meta.updatedAt ?? EPOCH,
      // Bytes from the zip wait to upload. A row without them is never
      // uploaded: a signed-in device downloads the image instead, unless the
      // table already holds it.
      ...(full
        ? { needsUpload: 1 as const }
        : held.has(meta.hash)
          ? {}
          : { needsDownload: 1 as const }),
    }
    writes.push(row)
    localByHash.set(meta.hash, row)
  }
  count.added += writes.length
  if (newBytes.length > 0) await db.photoBytes.bulkAdd(newBytes)
  if (writes.length > 0) await db.photos.bulkPut(writes)
  if (fills.length > 0) await db.photos.bulkUpdate(fills)
  return { idMap, matched, tombstones }
}

/**
 * A live incoming step that now points at a photo deleted here brings that
 * photo back, as adding the same photo in the app does.
 */
async function reviveReusedPhotos(
  addedEntries: BackupJson['entries'],
  matched: Set<string>,
  count: ImportResult,
) {
  const ids = new Set(
    addedEntries
      .filter((e) => !e.deletedAt && e.photoId && matched.has(e.photoId))
      .map((e) => e.photoId as string),
  )
  const deleted = (await db.photos.bulkGet([...ids])).filter(
    (p) => p?.deletedAt,
  )
  if (deleted.length === 0) return
  await db.photos.bulkUpdate(
    deleted.map((p) => ({
      key: (p as Photo).id,
      changes: {
        ...UNDELETE_PHOTO,
      },
    })),
  )
  count.updated += deleted.length
}

/**
 * The backup's settings win, with three exceptions. A default clay that names
 * no live clay after the import keeps the current default. The later
 * lastBackupAt is kept. The retired persistRequested flag is never taken from
 * a backup. On a device that has settings, their sync marks (dirty,
 * updatedAt) stay as they are, so the change tracker marks and stamps the row
 * only when a synced field really changes.
 */
async function mergeSettings(
  incoming: Settings | null | undefined,
  clayIdMap: Map<string, string>,
  count: ImportResult,
) {
  if (!incoming) return
  const current = await db.settings.get('app')
  const {
    persistRequested: _ignored,
    dirty: _dirty,
    updatedAt: _updatedAt,
    ...rest
  } = incoming
  const next: Settings = { ...rest, id: 'app' }
  if (current?.updatedAt) next.updatedAt = current.updatedAt
  if (current?.dirty) next.dirty = current.dirty
  // Settings this restore adds keep the backup's change time, as other rows do.
  if (!current) next.updatedAt = incoming.updatedAt ?? EPOCH

  if (next.defaultClayId) {
    next.defaultClayId = clayIdMap.get(next.defaultClayId) ?? next.defaultClayId
  }
  const clay = next.defaultClayId
    ? await db.clays.get(next.defaultClayId)
    : undefined
  if (!clay || clay.deletedAt) {
    if (current?.defaultClayId) next.defaultClayId = current.defaultClayId
    else delete next.defaultClayId
  }

  const latest = [current?.lastBackupAt, incoming.lastBackupAt]
    .filter((t): t is string => typeof t === 'string')
    .sort()
    .pop()
  if (latest) next.lastBackupAt = latest
  else delete next.lastBackupAt

  if (current) {
    const { persistRequested: _old, ...same } = current
    if (sameFields(same, next)) return
  }
  if (current) count.updated++
  else count.added++
  await db.settings.put(next)
}

function sameFields(a: object, b: object): boolean {
  const defined = (o: object) =>
    Object.entries(o).filter(([, v]) => v !== undefined)
  const left = defined(a)
  const right = new Map(defined(b))
  return (
    left.length === right.size && left.every(([k, v]) => right.get(k) === v)
  )
}
