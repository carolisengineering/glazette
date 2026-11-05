import type { EntityTable, IDType } from 'dexie'
import { strFromU8, type Unzipped, unzipSync } from 'fflate'
import { db, newId } from '../db/db'
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import type { Photo, Settings } from '../db/types'
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

export interface ImportResult {
  /** New rows across all tables. */
  added: number
  /** Rows replaced by a newer copy, or newly tombstoned. */
  updated: number
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

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
    ],
    // Must be an async function: Dexie keeps the transaction across native
    // awaits only when the scope function itself is async.
    async () => await merge(json, files),
  )
}

function unpack(bytes: Uint8Array): { json: BackupJson; files: Unzipped } {
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
  return { json, files }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Rows must be objects with string ids (and any other listed string keys) for the merge to work. */
const areRows = (v: unknown, ...stringKeys: string[]) =>
  Array.isArray(v) &&
  v.every(
    (row) =>
      isObject(row) &&
      ['id', ...stringKeys].every((k) => typeof row[k] === 'string'),
  )

function isBackup(json: unknown): json is BackupJson {
  return (
    isObject(json) &&
    json.version === BACKUP_VERSION &&
    areRows(json.pieces, 'updatedAt') &&
    areRows(json.entries) &&
    areRows(json.glazeApps) &&
    areRows(json.glazes) &&
    areRows(json.clays) &&
    areRows(json.photos, 'hash') &&
    (json.settings == null || isObject(json.settings))
  )
}

async function merge(json: BackupJson, files: Unzipped): Promise<ImportResult> {
  const count: ImportResult = { added: 0, updated: 0 }

  await mergeKeepingLocal(db.clays, json.clays, count)
  await mergeKeepingLocal(
    db.glazes,
    json.glazes.map((g) =>
      typeof g.color === 'string' && HEX_COLOR.test(g.color)
        ? g
        : { ...g, color: DEFAULT_GLAZE_COLOR },
    ),
    count,
  )
  await mergePieces(json.pieces, count)
  const { idMap, matched } = await mergePhotos(json.photos, files, count)

  const entries = json.entries.map((e) => {
    const photoId = e.photoId && idMap.get(e.photoId)
    return photoId ? { ...e, photoId } : e
  })
  const addedEntries = await mergeKeepingLocal(db.entries, entries, count)
  await reviveReusedPhotos(addedEntries, matched, count)

  await mergeKeepingLocal(db.glazeApps, json.glazeApps, count)
  await mergeSettings(json.settings, count)
  return count
}

const uniqueById = <T extends { id: string }>(rows: T[]): T[] => [
  ...new Map(rows.map((r) => [r.id, r])).values(),
]

/**
 * For tables without updatedAt. Unknown ids are added. Known ids keep the
 * local row, except that an incoming tombstone is applied to a live row:
 * deletions spread, edits never overwrite. Returns the added rows.
 */
async function mergeKeepingLocal<T extends { id: string; deletedAt?: string }>(
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
      added.push(row)
      writes.push(row)
    } else if (row.deletedAt && !mine.deletedAt) {
      writes.push({ ...mine, deletedAt: row.deletedAt })
      count.updated++
    }
  })
  count.added += added.length
  if (writes.length > 0) await table.bulkPut(writes)
  return added
}

/** A known piece is replaced only by a newer updatedAt (a newer tombstone included). */
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
      return true
    }
    if (row.updatedAt > mine.updatedAt) {
      count.updated++
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
 * local one. A new hash is added with its bytes from the zip, or skipped when
 * the zip lacks the image: its steps keep their photoId and show a placeholder.
 * Returns the incoming-to-local id map and the ids of photos already stored
 * here that matched by hash.
 */
async function mergePhotos(
  incoming: PhotoMeta[],
  files: Unzipped,
  count: ImportResult,
) {
  const idMap = new Map<string, string>()
  const matched = new Set<string>()
  if (incoming.length === 0) return { idMap, matched }

  const localByHash = new Map<string, Photo>()
  const sameHash = await db.photos
    .where('hash')
    .anyOf(incoming.map((p) => p.hash))
    .toArray()
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

  const writes: Photo[] = []
  for (const meta of incoming) {
    const local = localByHash.get(meta.hash)
    if (local) {
      if (local.id !== meta.id) idMap.set(meta.id, local.id)
      // Only photos stored before this import; a duplicate hash in the zip
      // just maps to the copy added a moment ago.
      if (!writes.includes(local)) matched.add(local.id)
      continue
    }
    const full = files[photoPath(meta.hash)]
    if (!full) continue
    // A missing thumbnail falls back to the full image rather than losing the photo.
    const thumb = files[thumbPath(meta.hash)] ?? full
    // An id taken by a different photo gets a fresh one, never an overwrite.
    const id = usedIds.has(meta.id) ? newId() : meta.id
    if (id !== meta.id) idMap.set(meta.id, id)
    usedIds.add(id)
    const row: Photo = { ...meta, id, blob: jpeg(full), thumb: jpeg(thumb) }
    writes.push(row)
    localByHash.set(meta.hash, row)
  }
  count.added += writes.length
  if (writes.length > 0) await db.photos.bulkPut(writes)
  return { idMap, matched }
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
  for (const photo of await db.photos.bulkGet([...ids])) {
    if (photo?.deletedAt) {
      await db.photos.update(photo.id, { deletedAt: undefined })
      count.updated++
    }
  }
}

/**
 * The backup's settings win, except a default clay that names no clay after
 * the import: then the current default stays.
 */
async function mergeSettings(
  incoming: Settings | null | undefined,
  count: ImportResult,
) {
  if (!incoming) return
  const current = await db.settings.get('app')
  const next: Settings = { ...incoming, id: 'app' }
  const clayExists =
    next.defaultClayId !== undefined &&
    (await db.clays.get(next.defaultClayId)) !== undefined
  if (!clayExists) {
    if (current?.defaultClayId) next.defaultClayId = current.defaultClayId
    else delete next.defaultClayId
  }
  if (current && sameFields(current, next)) return
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
