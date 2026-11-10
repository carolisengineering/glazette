import { hashesHeld } from '../photos/bytes'
import { db as appDb, type GlazetteDB, newId } from './db'
import { buildSteps } from './ops'
import { currentStage, STAGES, stagesBetween } from './stage'
import type { Photo, Piece, Stage } from './types'

const nowIso = (): string => new Date().toISOString()

const tablesOf = (db: GlazetteDB) => [
  db.pieces,
  db.entries,
  db.glazeApps,
  db.photos,
  db.photoBytes,
]

/** Photos with their place cleared, waiting to download when this device lacks their bytes. */
async function bringBack(db: GlazetteDB, photos: Photo[]): Promise<void> {
  if (photos.length === 0) return
  const held = await hashesHeld(
    db,
    photos.map((p) => p.hash),
  )
  await db.photos.bulkUpdate(
    photos.map((p) => ({
      key: p.id,
      changes: {
        deletedAt: undefined,
        lastPieceId: undefined,
        lastEntryId: undefined,
        lastStage: undefined,
        ...(p.blob || held.has(p.hash) ? {} : { needsDownload: 1 as const }),
      },
    })),
  )
}

async function putBackPieceRows(db: GlazetteDB, id: string): Promise<void> {
  const piece = await db.pieces.get(id)
  if (!piece?.deletedAt || piece.purgedAt) return
  const steps = await db.entries.where('pieceId').equals(id).toArray()
  const photoIds = [
    ...new Set(
      steps.flatMap((s) => (!s.deletedAt && s.photoId ? [s.photoId] : [])),
    ),
  ]
  const photos = (await db.photos.bulkGet(photoIds)).filter(
    (p): p is Photo => !!p && !!p.deletedAt && !p.purgedAt,
  )
  await db.pieces.update(id, { deletedAt: undefined, updatedAt: nowIso() })
  await bringBack(db, photos)
}

/**
 * Brings a deleted piece back with the steps and photos it had. A step deleted
 * before the piece stays deleted. A deleted photo that one of its live steps
 * shows comes back too. Does nothing when the piece is missing, live or purged.
 * `db` is the app's database unless a test passes another.
 */
export function putBackPiece(
  id: string,
  db: GlazetteDB = appDb,
): Promise<void> {
  return db.transaction('rw', tablesOf(db), () => putBackPieceRows(db, id))
}

/**
 * Brings a deleted photo back where it was: on its free step, on a new step of
 * the piece it was on, or on a new piece when that piece is gone. A deleted
 * piece comes back too. Returns the piece the photo is now on, or undefined
 * (changing nothing) when the photo is missing, live or purged.
 */
export function putBackPhoto(
  id: string,
  db: GlazetteDB = appDb,
): Promise<Piece | undefined> {
  return db.transaction('rw', tablesOf(db), async () => {
    const photo = await db.photos.get(id)
    if (!photo?.deletedAt || photo.purgedAt) return undefined
    const now = nowIso()
    const stage: Stage = STAGES.includes(photo.lastStage as Stage)
      ? (photo.lastStage as Stage)
      : 'thrown'
    const taken = new Date(photo.takenAt)
    const date = Number.isNaN(taken.getTime()) ? undefined : taken.toISOString()
    const dated = date ? { date } : {}
    const home = photo.lastPieceId
      ? await db.pieces.get(photo.lastPieceId)
      : undefined

    await bringBack(db, [photo])

    if (!home || home.purgedAt) {
      const pieceId = newId()
      const { entries } = buildSteps(
        pieceId,
        stagesBetween(undefined, stage),
        { stage, photoId: id, ...dated },
        [],
      )
      await db.pieces.add({
        id: pieceId,
        createdAt: date ?? now,
        updatedAt: now,
      })
      await db.entries.bulkAdd(entries)
      return db.pieces.get(pieceId)
    }

    if (home.deletedAt) await putBackPieceRows(db, home.id)
    const step = photo.lastEntryId
      ? await db.entries.get(photo.lastEntryId)
      : undefined
    if (step && !step.deletedAt && !step.photoId && step.pieceId === home.id) {
      await db.entries.update(step.id, { photoId: id })
    } else {
      const existing = await db.entries
        .where('pieceId')
        .equals(home.id)
        .toArray()
      const { entries } = buildSteps(
        home.id,
        stagesBetween(currentStage(existing), stage),
        { stage, photoId: id, ...dated },
        [],
      )
      await db.entries.bulkAdd(entries)
    }
    await db.pieces.update(home.id, { updatedAt: now })
    return db.pieces.get(home.id)
  })
}
