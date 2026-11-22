import type { GlazetteDB } from '../db/db'
import type { Photo, Stage } from '../db/types'
import { changeTime } from './records'

/**
 * A photo that one copy of a step showed and the copy sync kept doesn't, and
 * the step it was on.
 */
export interface DroppedPhoto {
  photoId: string
  pieceId: string
  entryId: string
  stage: Stage
}

/**
 * Sends each dropped photo to Recently Deleted, remembering the step it was
 * dropped from, so Put back can return it there.
 *
 * Sync keeps the last-changed copy of a step whole. When one device swaps or
 * adds a step's photo and another edits the same step before they sync, the
 * photo on the copy that loses would otherwise end up on no step, where
 * nothing can reach it.
 *
 * A photo that a live step, a live glaze's swatch or a live combo's swatch
 * still shows stays. So does a photo that's missing, already deleted, purged
 * or merged into another. A photo dropped more than once takes its place from
 * the first drop. Each release is dated past the photo's last change and is a
 * normal tracked write, so it syncs. Returns how many photos it released.
 */
export function releaseDropped(
  db: GlazetteDB,
  dropped: DroppedPhoto[],
): Promise<number> {
  if (dropped.length === 0) return Promise.resolve(0)
  return db.transaction(
    'rw',
    [db.photos, db.entries, db.glazes, db.combos],
    async () => {
      const firstDrop = new Map<string, DroppedPhoto>()
      for (const drop of dropped) {
        if (!firstDrop.has(drop.photoId)) firstDrop.set(drop.photoId, drop)
      }
      const photos = (await db.photos.bulkGet([...firstDrop.keys()])).filter(
        (p): p is Photo => !!p && !p.deletedAt && !p.purgedAt && !p.mergedInto,
      )
      if (photos.length === 0) return 0

      const shown = new Set<string>()
      await db.entries
        .filter((e) => !e.deletedAt && e.photoId !== undefined)
        .each((e) => {
          shown.add(e.photoId as string)
        })
      await db.glazes
        .filter((g) => !g.deletedAt && g.swatchPhotoId !== undefined)
        .each((g) => {
          shown.add(g.swatchPhotoId as string)
        })
      await db.combos
        .filter((c) => !c.deletedAt)
        .each((c) => {
          shown.add(c.swatchPhotoId)
        })

      const now = new Date().toISOString()
      const changes: { key: string; changes: Partial<Photo> }[] = []
      for (const photo of photos) {
        if (shown.has(photo.id)) continue
        const drop = firstDrop.get(photo.id) as DroppedPhoto
        changes.push({
          key: photo.id,
          changes: {
            deletedAt: now,
            lastPieceId: drop.pieceId,
            lastEntryId: drop.entryId,
            lastStage: drop.stage,
            updatedAt: changeTime(photo, now),
          },
        })
      }
      if (changes.length > 0) await db.photos.bulkUpdate(changes)
      return changes.length
    },
  )
}
