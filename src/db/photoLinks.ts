import { changeTime } from '../sync/records'
import type { GlazetteDB } from './db'
import type { StageEntry } from './types'

/**
 * Sends a photo that `entry` no longer shows to Recently Deleted, unless
 * another live step still shows it (identical photos share one row). The
 * caller has already moved `photoId` off `entry`. Does nothing when the photo
 * is missing, purged or already deleted. Call inside a transaction that
 * includes `db.entries` and `db.photos`.
 */
export async function releasePhoto(
  db: GlazetteDB,
  entry: StageEntry,
  photoId: string,
  now: string,
): Promise<void> {
  const photo = await db.photos.get(photoId)
  if (!photo || photo.deletedAt || photo.purgedAt) return
  const stillUsed = await db.entries
    .filter((e) => e.photoId === photoId && !e.deletedAt)
    .count()
  if (stillUsed > 0) return
  await db.photos.update(photoId, {
    deletedAt: now,
    lastPieceId: entry.pieceId,
    lastEntryId: entry.id,
    lastStage: entry.stage,
    updatedAt: changeTime(photo, now),
  })
}
