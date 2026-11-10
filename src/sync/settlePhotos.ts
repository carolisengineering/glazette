import type { GlazetteDB } from '../db/db'
import { compareEntries } from '../db/stage'
import type { Photo, StageEntry } from '../db/types'
import { hashesHeld } from '../photos/bytes'
import { changedAt, justAfter } from './records'

/** Where a deleted photo was: the latest of the deleted steps that show it. */
function placeOf(steps: StageEntry[]): Partial<Photo> {
  let latest = steps[0]
  for (const step of steps) {
    if (compareEntries(step, latest) >= 0) latest = step
  }
  return {
    lastPieceId: latest.pieceId,
    lastEntryId: latest.id,
    lastStage: latest.stage,
  }
}

/** Now, or just after the photo's last change if its clock is ahead of ours. */
function changeTime(photo: Photo, now: string): string {
  const after = justAfter(changedAt(photo))
  return after > now ? after : now
}

/**
 * Brings each photo in line with the steps that show it, once a pull has
 * brought in every step. A deleted photo that a live step shows comes back
 * (a live step on a deleted piece counts). A live photo that only deleted steps
 * show is deleted, and remembers the step it was on. A deleted photo without
 * that place gets it from a deleted step. A photo no step shows is left alone:
 * only an actual delete deletes a photo. Merged duplicates and stubs are left
 * alone too.
 *
 * Each change is dated past the photo's last one, so it wins over the copy
 * it changes. A normal tracked write, so the changes sync. Bytes are never
 * touched.
 */
export function settlePhotos(db: GlazetteDB): Promise<void> {
  return db.transaction(
    'rw',
    [db.photos, db.entries, db.photoBytes],
    async () => {
      const photos = await db.photos
        .filter((p) => !p.mergedInto && !p.purgedAt)
        .toArray()
      const live = new Set<string>()
      const deleted = new Map<string, StageEntry[]>()
      const steps = await db.entries
        .filter((e) => e.photoId !== undefined)
        .toArray()
      for (const step of steps) {
        const photoId = step.photoId as string
        if (!step.deletedAt) live.add(photoId)
        else {
          const group = deleted.get(photoId)
          if (group) group.push(step)
          else deleted.set(photoId, [step])
        }
      }

      const now = new Date().toISOString()
      const changes: { key: string; changes: Partial<Photo> }[] = []
      const back = photos.filter((p) => p.deletedAt && live.has(p.id))
      const held = await hashesHeld(
        db,
        back.map((p) => p.hash),
      )
      for (const photo of back) {
        const hasBytes = !!photo.blob || held.has(photo.hash)
        changes.push({
          key: photo.id,
          changes: {
            deletedAt: undefined,
            lastPieceId: undefined,
            lastEntryId: undefined,
            lastStage: undefined,
            updatedAt: changeTime(photo, now),
            ...(hasBytes ? {} : { needsDownload: 1 as const }),
          },
        })
      }
      for (const photo of photos) {
        const shownBy = deleted.get(photo.id)
        if (live.has(photo.id) || !shownBy) continue
        if (!photo.deletedAt) {
          changes.push({
            key: photo.id,
            changes: {
              deletedAt: now,
              ...placeOf(shownBy),
              updatedAt: changeTime(photo, now),
            },
          })
        } else if (photo.lastPieceId === undefined) {
          changes.push({
            key: photo.id,
            changes: { ...placeOf(shownBy), updatedAt: changeTime(photo, now) },
          })
        }
      }
      if (changes.length > 0) await db.photos.bulkUpdate(changes)
    },
  )
}
