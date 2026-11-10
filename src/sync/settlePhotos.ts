import { type GlazetteDB, newId, UNDELETE_PHOTO } from '../db/db'
import { compareEntries } from '../db/stage'
import type { Photo, StageEntry } from '../db/types'
import { hashesHeld, keepBytes } from '../photos/bytes'
import { changeTime } from './records'

/**
 * Where a deleted photo was: the latest of the deleted steps that show it that
 * can still be a place. A purged step, or a deleted step of a purged piece,
 * can't. Nothing when none can.
 */
function placeOf(
  steps: StageEntry[],
  purgedPieces: Set<string>,
): Partial<Photo> {
  let latest: StageEntry | undefined
  for (const step of steps) {
    if (step.purgedAt || (step.deletedAt && purgedPieces.has(step.pieceId)))
      continue
    if (!latest || compareEntries(step, latest) >= 0) latest = step
  }
  if (!latest) return {}
  return {
    lastPieceId: latest.pieceId,
    lastEntryId: latest.id,
    lastStage: latest.stage,
  }
}

/** Adds an item to the list kept under a key. */
function addTo<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key)
  if (list) list.push(item)
  else map.set(key, [item])
}

/**
 * Brings each photo in line with the steps that show it, once a pull has
 * brought in every step. A deleted photo that a live step shows comes back
 * (a live step on a deleted piece counts, but one on a purged piece counts as
 * deleted). A live photo that only deleted steps show is deleted, and
 * remembers the step it was on. A deleted photo without that place gets it
 * from a deleted step. A photo no step shows is left alone:
 * only an actual delete deletes a photo. Merged duplicates are left alone.
 *
 * A purged photo (a stub) stays as it is. But if a live step still shows it,
 * as after restoring a backup from before the purge, and this device holds
 * its bytes, the image comes back as a new photo that waits to upload, and
 * those steps move to it. Without the bytes it's left alone.
 *
 * Each change is dated past the row's last one, so it wins over the copy it
 * changes. A normal tracked write, so the changes sync. Bytes are never
 * removed. Every photo and step is read on each sync, which is fine at a
 * journal's scale.
 */
export function settlePhotos(db: GlazetteDB): Promise<void> {
  return db.transaction(
    'rw',
    [db.photos, db.entries, db.photoBytes, db.pieces],
    async () => {
      const rows = await db.photos.filter((p) => !p.mergedInto).toArray()
      const photos = rows.filter((p) => !p.purgedAt)
      const purgedPieces = new Set(
        await db.pieces.filter((p) => !!p.purgedAt).primaryKeys(),
      )
      const live = new Map<string, StageEntry[]>()
      const deleted = new Map<string, StageEntry[]>()
      const steps = await db.entries
        .filter((e) => e.photoId !== undefined)
        .toArray()
      for (const step of steps) {
        const gone = step.deletedAt || purgedPieces.has(step.pieceId)
        addTo(gone ? deleted : live, step.photoId as string, step)
      }

      const now = new Date().toISOString()
      const changes: { key: string; changes: Partial<Photo> }[] = []
      const back = photos.filter((p) => p.deletedAt && live.has(p.id))
      const stranded = rows.filter((p) => p.purgedAt && live.has(p.id))
      const held = await hashesHeld(db, [
        ...back.map((p) => p.hash),
        ...stranded.map((p) => p.hash),
      ])
      for (const photo of back) {
        const hasBytes = !!photo.blob || held.has(photo.hash)
        changes.push({
          key: photo.id,
          changes: {
            ...UNDELETE_PHOTO,
            updatedAt: changeTime(photo, now),
            ...(hasBytes ? {} : { needsDownload: 1 as const }),
          },
        })
      }
      for (const photo of photos) {
        const shownBy = deleted.get(photo.id)
        if (live.has(photo.id) || !shownBy) continue
        const place = placeOf(shownBy, purgedPieces)
        if (!photo.deletedAt) {
          changes.push({
            key: photo.id,
            changes: {
              deletedAt: now,
              ...place,
              updatedAt: changeTime(photo, now),
            },
          })
        } else if (photo.lastPieceId === undefined && place.lastPieceId) {
          changes.push({
            key: photo.id,
            changes: { ...place, updatedAt: changeTime(photo, now) },
          })
        }
      }
      if (changes.length > 0) await db.photos.bulkUpdate(changes)

      const repointed: { key: string; changes: Partial<StageEntry> }[] = []
      for (const stub of stranded) {
        if (!stub.blob && !held.has(stub.hash)) continue
        // Bytes still on an old row go to the table, where the new row finds
        // them. The stub keeps its own.
        if (stub.blob) {
          await keepBytes(db, {
            hash: stub.hash,
            blob: stub.blob,
            thumb: stub.thumb,
          })
        }
        const id = newId()
        await db.photos.add({
          id,
          hash: stub.hash,
          width: stub.width,
          height: stub.height,
          takenAt: stub.takenAt,
          needsUpload: 1,
        })
        for (const step of live.get(stub.id) as StageEntry[]) {
          repointed.push({
            key: step.id,
            changes: { photoId: id, updatedAt: changeTime(step, now) },
          })
        }
      }
      if (repointed.length > 0) await db.entries.bulkUpdate(repointed)
    },
  )
}
