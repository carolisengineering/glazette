import type { ProcessedImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import { db, newId } from './db'
import { DEFAULT_CLAY_NAME, DEFAULT_SETTINGS } from './seed'
import { currentStage, latestEntry, STAGES, stagesBetween } from './stage'
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

/** Saves the name shown above My Shelf. A blank name removes it, so the label goes back to "Studio". */
export async function setStudioName(name: string): Promise<void> {
  const trimmed = name.trim()
  await db.settings.update('app', { studioName: trimmed || undefined })
}

export function defaultNoteFor(stage: Stage, settings: Settings): string {
  if (stage === 'bisqued') return settings.bisqueNote
  if (stage === 'fired') return settings.firedNote
  return ''
}

type GlazeInput = Array<{
  glazeId: string
  dips?: number
  method?: GlazeApplication['method']
  note?: string
}>

/** A step the user skipped past: no photo, no date, no note. */
function filledEntry(pieceId: string, stage: Stage): StageEntry {
  return { id: newId(), pieceId, stage }
}

function glazeRows(
  entryId: string,
  pieceId: string,
  glazes: GlazeInput,
  startOrder = 0,
): GlazeApplication[] {
  return glazes.map((g, i) => ({
    id: newId(),
    entryId,
    pieceId,
    glazeId: g.glazeId,
    order: startOrder + i,
    dips: g.dips,
    method: g.method,
    note: g.note,
  }))
}

/**
 * Builds the filled steps for `skipped` stages plus the chosen step, and the
 * glaze rows for whichever of them is the Glazed step. Dates are never invented.
 */
function buildSteps(
  pieceId: string,
  skipped: Stage[],
  chosen: Omit<StageEntry, 'id' | 'pieceId'>,
  glazes: GlazeInput,
): { entries: StageEntry[]; apps: GlazeApplication[]; chosenId: string } {
  const entries = skipped.map((stage) => filledEntry(pieceId, stage))
  const chosenEntry: StageEntry = { id: newId(), pieceId, ...chosen }
  entries.push(chosenEntry)
  const glazed = entries.find((e) => e.stage === 'glazed')
  const apps = glazed ? glazeRows(glazed.id, pieceId, glazes) : []
  return { entries, apps, chosenId: chosenEntry.id }
}

function optionalDate(value: string | undefined): string | undefined {
  return value === undefined ? undefined : toIsoDate(value)
}

export async function createPiece(input: {
  photo?: ProcessedImage
  name?: string
  form?: Piece['form']
  clayId?: string
  date?: string
  stage?: Stage
  note?: string
  glazes?: GlazeInput
}): Promise<string> {
  const now = nowIso()
  const stage = input.stage ?? 'thrown'
  const stepDate = optionalDate(input.date ?? input.photo?.takenAt)
  const createdAt = stepDate ?? now
  const piece: Piece = {
    id: newId(),
    name: input.name,
    form: input.form,
    clayId: input.clayId,
    createdAt,
    updatedAt: now,
  }
  await db.transaction(
    'rw',
    db.pieces,
    db.entries,
    db.glazeApps,
    db.photos,
    async () => {
      const photoId = input.photo ? await storePhoto(input.photo) : undefined
      const { entries, apps } = buildSteps(
        piece.id,
        stagesBetween(undefined, stage),
        {
          stage,
          photoId,
          note: input.note,
          ...(stepDate ? { date: stepDate } : {}),
        },
        input.glazes ?? [],
      )
      await db.pieces.add(piece)
      await db.entries.bulkAdd(entries)
      if (apps.length > 0) await db.glazeApps.bulkAdd(apps)
    },
  )
  return piece.id
}

export async function addStageEntry(input: {
  pieceId: string
  stage: Stage
  photo?: ProcessedImage
  note?: string
  date?: string
  glazes?: GlazeInput
}): Promise<string> {
  const now = nowIso()
  const date = optionalDate(input.date ?? input.photo?.takenAt)
  return db.transaction(
    'rw',
    db.entries,
    db.glazeApps,
    db.pieces,
    db.photos,
    async () => {
      const piece = await db.pieces.get(input.pieceId)
      if (!piece || piece.deletedAt) throw new Error('Piece not found')
      const existing = await db.entries
        .where('pieceId')
        .equals(input.pieceId)
        .toArray()
      const photoId = input.photo ? await storePhoto(input.photo) : undefined
      const { entries, apps, chosenId } = buildSteps(
        input.pieceId,
        stagesBetween(currentStage(existing), input.stage),
        {
          stage: input.stage,
          photoId,
          note: input.note,
          ...(date ? { date } : {}),
        },
        input.glazes ?? [],
      )
      await db.entries.bulkAdd(entries)
      if (apps.length > 0) await db.glazeApps.bulkAdd(apps)
      await db.pieces.update(input.pieceId, { updatedAt: now })
      return chosenId
    },
  )
}

/**
 * Moves a just-created piece to another stage. The step holding the photo (or
 * the latest step when none does) takes the stage; photo-less steps at or after
 * it are soft-deleted; earlier stages without a live step are filled. Glaze rows
 * belonging to a step that is deleted, or that stops being Glazed, are removed
 * (glaze rows have no soft-delete flag).
 */
export async function restagePiece(
  pieceId: string,
  stage: Stage,
): Promise<void> {
  const now = nowIso()
  await db.transaction('rw', db.entries, db.glazeApps, db.pieces, async () => {
    const live = (
      await db.entries.where('pieceId').equals(pieceId).toArray()
    ).filter((e) => !e.deletedAt)
    const moved = live.find((e) => e.photoId) ?? latestEntry(live)
    if (!moved) return
    const dropGlazesFor: string[] = []
    const softDeletes: string[] = []
    const hardDeletes: string[] = []
    const updates: { key: string; changes: Partial<StageEntry> }[] = []
    if (moved.stage !== stage) {
      updates.push({ key: moved.id, changes: { stage } })
      if (moved.stage === 'glazed') dropGlazesFor.push(moved.id)
    }
    const covered = new Set<Stage>([stage])
    const withGlazes = new Set(
      (
        await db.glazeApps
          .where('entryId')
          .anyOf(live.map((e) => e.id))
          .toArray()
      ).map((a) => a.entryId),
    )
    for (const e of live) {
      if (e.id === moved.id) continue
      if (!e.photoId && STAGES.indexOf(e.stage) >= STAGES.indexOf(stage)) {
        // A blank step was made moments ago on the unfinished new-piece sheet:
        // drop it outright so it doesn't linger as a tombstone in backups.
        const blank = !e.date && !e.note && !withGlazes.has(e.id)
        if (blank) hardDeletes.push(e.id)
        else softDeletes.push(e.id)
        dropGlazesFor.push(e.id)
      } else {
        covered.add(e.stage)
      }
    }
    if (updates.length > 0) {
      await db.entries.bulkUpdate(updates)
    }
    if (softDeletes.length > 0) {
      await db.entries.bulkUpdate(
        softDeletes.map((key) => ({ key, changes: { deletedAt: now } })),
      )
    }
    if (hardDeletes.length > 0) await db.entries.bulkDelete(hardDeletes)
    const fills = stagesBetween(undefined, stage)
      .filter((s) => !covered.has(s))
      .map((s) => filledEntry(pieceId, s))
    if (fills.length > 0) await db.entries.bulkAdd(fills)
    if (dropGlazesFor.length > 0) {
      await db.glazeApps.where('entryId').anyOf(dropGlazesFor).delete()
    }
    await db.pieces.update(pieceId, { updatedAt: now })
  })
}

/** Adds glaze applications to the piece's latest live Glazed step; does nothing when there is none. */
export async function addGlazesToPiece(
  pieceId: string,
  glazes: GlazeInput,
): Promise<void> {
  if (glazes.length === 0) return
  await db.transaction('rw', db.entries, db.glazeApps, db.pieces, async () => {
    const entries = await db.entries.where('pieceId').equals(pieceId).toArray()
    const glazed = latestEntry(entries, 'glazed')
    if (!glazed) return
    const existing = await db.glazeApps
      .where('entryId')
      .equals(glazed.id)
      .toArray()
    const start = existing.reduce((max, a) => Math.max(max, a.order + 1), 0)
    await db.glazeApps.bulkAdd(glazeRows(glazed.id, pieceId, glazes, start))
    await db.pieces.update(pieceId, { updatedAt: nowIso() })
  })
}

/** Sets a step's date, or clears it (removes the field) when `date` is undefined. */
export async function setEntryDate(
  entryId: string,
  date: string | undefined,
): Promise<void> {
  const value = optionalDate(date)
  await db.transaction('rw', db.entries, db.pieces, async () => {
    const entry = await db.entries.get(entryId)
    if (!entry) throw new Error('Entry not found')
    await db.entries.update(entryId, { date: value })
    await db.pieces.update(entry.pieceId, { updatedAt: nowIso() })
  })
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
