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
  return { json, files }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringOrAbsent = (v: unknown) =>
  v === undefined || typeof v === 'string'

/**
 * Rows must be objects with a string id and the other listed string keys, and
 * `deletedAt` must be a string or absent.
 */
const areRows = (v: unknown, ...stringKeys: string[]) =>
  Array.isArray(v) &&
  v.every(
    (row) =>
      isObject(row) &&
      ['id', ...stringKeys].every((k) => typeof row[k] === 'string') &&
      isStringOrAbsent(row.deletedAt),
  )

function areSettings(v: unknown): boolean {
  if (v == null) return true
  return (
    isObject(v) &&
    ['defaultCone', 'bisqueNote', 'firedNote'].every(
      (k) => typeof v[k] === 'string',
    ) &&
    ['studioName', 'defaultClayId', 'lastBackupAt'].every((k) =>
      isStringOrAbsent(v[k]),
    )
  )
}

function isBackup(json: unknown): json is BackupJson {
  return (
    isObject(json) &&
    json.version === BACKUP_VERSION &&
    areRows(json.pieces, 'updatedAt') &&
    areRows(json.entries) &&
    areRows(json.glazeApps) &&
    areRows(json.glazes, 'name') &&
    areRows(json.clays, 'name') &&
    areRows(json.photos, 'hash') &&
    areSettings(json.settings)
  )
}

async function merge(json: BackupJson, files: Unzipped): Promise<ImportResult> {
  const count: ImportResult = { added: 0, updated: 0 }

  const clays = await matchByName(db.clays, json.clays)
  await mergeKeepingLocal(db.clays, clays.rows, count)
  const glazes = await matchByName(
    db.glazes,
    json.glazes.map((g) =>
      typeof g.color === 'string' && HEX_COLOR.test(g.color)
        ? g
        : { ...g, color: DEFAULT_GLAZE_COLOR },
    ),
  )
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
  const addedEntries = await mergeKeepingLocal(db.entries, entries, count)
  await reviveReusedPhotos(addedEntries, photos.matched, count)

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

const uniqueById = <T extends { id: string }>(rows: T[]): T[] => [
  ...new Map(rows.map((r) => [r.id, r])).values(),
]

const nameKey = (name: string) => name.trim().toLowerCase()

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

/** The later of updatedAt and deletedAt: the generic soft delete sets only deletedAt. */
const lastChanged = (p: { updatedAt: string; deletedAt?: string }) =>
  p.deletedAt && p.deletedAt > p.updatedAt ? p.deletedAt : p.updatedAt

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
      return true
    }
    if (lastChanged(row) > lastChanged(mine)) {
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
    if (!full) {
      // The step keeps a photoId that shows the placeholder. If that id
      // belongs to a different photo here, point the step at an unused id.
      if (usedIds.has(meta.id)) idMap.set(meta.id, newId())
      continue
    }
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
 * The backup's settings win, with three exceptions. A default clay that names
 * no live clay after the import keeps the current default. The later
 * lastBackupAt is kept. persistRequested belongs to this install and never
 * comes from a backup.
 */
async function mergeSettings(
  incoming: Settings | null | undefined,
  clayIdMap: Map<string, string>,
  count: ImportResult,
) {
  if (!incoming) return
  const current = await db.settings.get('app')
  const next: Settings = { ...incoming, id: 'app' }

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

  if (current?.persistRequested !== undefined) {
    next.persistRequested = current.persistRequested
  } else delete next.persistRequested

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
