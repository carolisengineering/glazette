import type { ProcessedImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import { db, newId } from './db'
import { DEFAULT_CLAY_NAME, DEFAULT_SETTINGS } from './seed'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Piece,
  Settings,
  Stage,
  StageEntry,
} from './types'

const nowIso = (): string => new Date().toISOString()

/** Stored dates are always full ISO timestamps; stage and timeline ordering compares them as strings. */
function toIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  return date.toISOString()
}

export async function ensureDefaults(): Promise<void> {
  await db.transaction('rw', db.clays, db.settings, async () => {
    if (await db.settings.get('app')) return
    const existing = await db.clays
      .filter((c) => !c.deletedAt && c.name === DEFAULT_CLAY_NAME)
      .first()
    const clayId = existing?.id ?? newId()
    if (!existing) await db.clays.add({ id: clayId, name: DEFAULT_CLAY_NAME })
    await db.settings.add({ ...DEFAULT_SETTINGS, defaultClayId: clayId })
  })
}

export function defaultNoteFor(stage: Stage, settings: Settings): string {
  if (stage === 'bisqued') return settings.bisqueNote
  if (stage === 'fired') return settings.firedNote
  return ''
}

export async function createPiece(input: {
  photo?: ProcessedImage
  name?: string
  form?: Piece['form']
  clayId?: string
  date?: string
}): Promise<string> {
  const now = nowIso()
  const createdAt = toIsoDate(input.date ?? input.photo?.takenAt ?? now)
  const piece: Piece = {
    id: newId(),
    name: input.name,
    form: input.form,
    clayId: input.clayId,
    createdAt,
    updatedAt: now,
  }
  await db.transaction('rw', db.pieces, db.entries, db.photos, async () => {
    const photoId = input.photo ? await storePhoto(input.photo) : undefined
    const entry: StageEntry = {
      id: newId(),
      pieceId: piece.id,
      stage: 'thrown',
      photoId,
      date: createdAt,
    }
    await db.pieces.add(piece)
    await db.entries.add(entry)
  })
  return piece.id
}

export async function addStageEntry(input: {
  pieceId: string
  stage: Stage
  photo?: ProcessedImage
  note?: string
  date?: string
  glazes?: Array<{
    glazeId: string
    dips?: number
    method?: GlazeApplication['method']
    note?: string
  }>
}): Promise<string> {
  const now = nowIso()
  const date = toIsoDate(input.date ?? input.photo?.takenAt ?? now)
  const entryId = newId()
  const apps: GlazeApplication[] = (input.glazes ?? []).map((g, order) => ({
    id: newId(),
    entryId,
    pieceId: input.pieceId,
    glazeId: g.glazeId,
    order,
    dips: g.dips,
    method: g.method,
    note: g.note,
  }))
  await db.transaction(
    'rw',
    db.entries,
    db.glazeApps,
    db.pieces,
    db.photos,
    async () => {
      const piece = await db.pieces.get(input.pieceId)
      if (!piece || piece.deletedAt) throw new Error('Piece not found')
      const photoId = input.photo ? await storePhoto(input.photo) : undefined
      const entry: StageEntry = {
        id: entryId,
        pieceId: input.pieceId,
        stage: input.stage,
        photoId,
        note: input.note,
        date,
      }
      await db.entries.add(entry)
      if (apps.length > 0) await db.glazeApps.bulkAdd(apps)
      await db.pieces.update(input.pieceId, { updatedAt: now })
    },
  )
  return entryId
}

export async function updatePiece(
  id: string,
  patch: Partial<Pick<Piece, 'name' | 'form' | 'clayId' | 'notes'>>,
): Promise<void> {
  await db.pieces.update(id, { ...patch, updatedAt: nowIso() })
}

export async function markLost(id: string, lost: boolean): Promise<void> {
  await db.pieces.update(id, { lost, updatedAt: nowIso() })
}

/** Photos are shared between entries (hash dedupe), so they are removed per entry with `removePhoto`. */
export async function softDelete(
  table: 'pieces' | 'entries' | 'glazes' | 'clays',
  id: string,
): Promise<void> {
  await db.table(table).update(id, { deletedAt: nowIso() })
}

/**
 * Removes the photo from one entry. The Photo row is soft-deleted only when no
 * other live entry still shows it, because identical photos share one row.
 */
export async function removePhoto(entryId: string): Promise<void> {
  await db.transaction('rw', db.entries, db.photos, db.pieces, async () => {
    const entry = await db.entries.get(entryId)
    if (!entry) throw new Error('Entry not found')
    const { photoId } = entry
    if (!photoId) return
    const now = nowIso()
    await db.entries.update(entryId, { photoId: undefined })
    const stillUsed = await db.entries
      .filter((e) => e.photoId === photoId && !e.deletedAt)
      .count()
    if (stillUsed === 0) await db.photos.update(photoId, { deletedAt: now })
    await db.pieces.update(entry.pieceId, { updatedAt: now })
  })
}

export async function upsertGlaze(
  input: Omit<Glaze, 'id' | 'deletedAt'> & { id?: string },
): Promise<string> {
  const id = input.id ?? newId()
  if (input.id) {
    await db.glazes.update(id, input)
  } else {
    await db.glazes.add({ ...input, id })
  }
  return id
}

export async function upsertClay(name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Clay name is required')
  const lower = trimmed.toLowerCase()
  return db.transaction('rw', db.clays, async () => {
    const match: Clay | undefined = await db.clays
      .filter((c) => !c.deletedAt && c.name.toLowerCase() === lower)
      .first()
    if (match) return match.id
    const id = newId()
    await db.clays.add({ id, name: trimmed })
    return id
  })
}
