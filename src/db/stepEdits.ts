import type { ProcessedImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import { changeTime } from '../sync/records'
import { db, newId, UNDELETE_PHOTO } from './db'
import { type GlazeInput, toIsoDate } from './ops'
import { releasePhoto } from './photoLinks'
import { followStartDate } from './startDate'
import type { GlazeApplication, StageEntry } from './types'

const nowIso = (): string => new Date().toISOString()

/**
 * Makes a Glazed step's live glazes equal `glazes`, in order. Row i updates the
 * i-th live layer in place (writing only changed fields); extra layers are
 * soft-deleted and extra inputs added. Returns whether anything changed.
 */
export async function setStepGlazes(
  entryId: string,
  glazes: GlazeInput,
): Promise<boolean> {
  return db.transaction('rw', db.entries, db.glazeApps, db.pieces, async () => {
    const entry = await db.entries.get(entryId)
    if (!entry || entry.deletedAt || entry.stage !== 'glazed') {
      throw new Error('Step not found')
    }
    const live = (await db.glazeApps.where('entryId').equals(entryId).toArray())
      .filter((a) => !a.deletedAt)
      .sort((a, b) => a.order - b.order)
    let changed = false
    for (let i = 0; i < glazes.length; i++) {
      const want = glazes[i]
      const have = live[i]
      if (!have) {
        await db.glazeApps.add({
          id: newId(),
          entryId,
          pieceId: entry.pieceId,
          glazeId: want.glazeId,
          order: i,
          dips: want.dips,
          method: want.method,
          note: want.note,
        })
        changed = true
        continue
      }
      const patch: Partial<GlazeApplication> = {}
      if (have.glazeId !== want.glazeId) patch.glazeId = want.glazeId
      if (have.order !== i) patch.order = i
      if (have.dips !== want.dips) patch.dips = want.dips
      if (have.method !== want.method) patch.method = want.method
      if (have.note !== want.note) patch.note = want.note
      if (Object.keys(patch).length > 0) {
        await db.glazeApps.update(have.id, patch)
        changed = true
      }
    }
    const deletedAt = nowIso()
    for (const extra of live.slice(glazes.length)) {
      await db.glazeApps.update(extra.id, { deletedAt })
      changed = true
    }
    if (changed) {
      await db.pieces.update(entry.pieceId, { updatedAt: nowIso() })
    }
    return changed
  })
}

export interface StepDetails {
  entryId: string
  note: string // trimmed; '' removes the note
  date: string | undefined // any parseable date, stored as full ISO; undefined clears
  photo?: ProcessedImage // a photo to put on the step
}

export interface PhotoSwap {
  entryId: string
  oldPhotoId: string
  newPhotoId: string
  oldDate?: string // the step's date before this save
}

/**
 * Saves a step's note, date and photo in one transaction. Glazes are saved
 * separately with `setStepGlazes`, on the piece's glaze step. Replacing an existing photo with a different image returns the
 * swap so it can be undone; the old photo goes to Recently Deleted unless
 * another live step shows it.
 */
export async function saveStepDetails(
  input: StepDetails,
): Promise<PhotoSwap | undefined> {
  return db.transaction(
    'rw',
    db.entries,
    db.pieces,
    db.photos,
    db.photoBytes,
    async () => {
      const entry = await db.entries.get(input.entryId)
      if (!entry || entry.deletedAt) throw new Error('Step not found')
      const now = nowIso()
      const note = input.note.trim() || undefined
      const date = input.date === undefined ? undefined : toIsoDate(input.date)
      const patch: Partial<StageEntry> = {}
      if (note !== entry.note) patch.note = note
      const dateChanged = date !== entry.date
      if (dateChanged) patch.date = date

      let swap: PhotoSwap | undefined
      if (input.photo) {
        const newPhotoId = await storePhoto(input.photo)
        if (newPhotoId !== entry.photoId) {
          patch.photoId = newPhotoId
          if (entry.photoId) {
            swap = {
              entryId: entry.id,
              oldPhotoId: entry.photoId,
              newPhotoId,
              oldDate: entry.date,
            }
          }
        }
      }
      if (Object.keys(patch).length === 0) return undefined
      await db.entries.update(entry.id, patch)
      if (swap) {
        await releasePhoto(db, { ...entry, ...patch }, swap.oldPhotoId, now)
      }
      if (dateChanged) await followStartDate(entry.pieceId)
      await db.pieces.update(entry.pieceId, { updatedAt: now })
      return swap
    },
  )
}

/**
 * Reverses a photo swap: puts the old photo and date back on the step and sends
 * the new photo to Recently Deleted (unless another live step shows it). Acts
 * only while the step is live and still shows the new photo, and the old photo
 * exists and isn't purged. Returns whether it acted.
 */
export async function undoPhotoSwap(swap: PhotoSwap): Promise<boolean> {
  return db.transaction('rw', db.entries, db.pieces, db.photos, async () => {
    const entry = await db.entries.get(swap.entryId)
    if (!entry || entry.deletedAt || entry.photoId !== swap.newPhotoId) {
      return false
    }
    const old = await db.photos.get(swap.oldPhotoId)
    if (!old || old.purgedAt) return false
    const now = nowIso()
    if (old.deletedAt) {
      await db.photos.update(old.id, {
        ...UNDELETE_PHOTO,
        updatedAt: changeTime(old, now),
      })
    }
    const patch: Partial<StageEntry> = {
      photoId: swap.oldPhotoId,
      date: swap.oldDate,
    }
    await db.entries.update(entry.id, patch)
    await releasePhoto(db, { ...entry, ...patch }, swap.newPhotoId, now)
    await followStartDate(entry.pieceId)
    await db.pieces.update(entry.pieceId, { updatedAt: now })
    return true
  })
}

/**
 * Puts a photo on a step that has none. An undated step takes the photo's
 * taken-at time as its date; a date already on the step stays.
 */
export async function addPhotoToStep(
  entryId: string,
  photo: ProcessedImage,
): Promise<void> {
  await db.transaction(
    'rw',
    db.entries,
    db.pieces,
    db.photos,
    db.photoBytes,
    async () => {
      const entry = await db.entries.get(entryId)
      if (!entry || entry.deletedAt) throw new Error('Step not found')
      if (entry.photoId) throw new Error('Step has a photo')
      const patch: Partial<StageEntry> = { photoId: await storePhoto(photo) }
      const undated = !entry.date
      if (undated) patch.date = toIsoDate(photo.takenAt)
      await db.entries.update(entry.id, patch)
      if (undated) await followStartDate(entry.pieceId)
      await db.pieces.update(entry.pieceId, { updatedAt: nowIso() })
    },
  )
}
