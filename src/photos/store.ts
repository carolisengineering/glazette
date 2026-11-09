import { db, newId } from '../db/db'
import { hashesHeld, keepBytes } from './bytes'
import type { ProcessedImage } from './process'

/** Must be called inside an open Dexie transaction that includes `db.photos` and `db.photoBytes`; dedupes by hash and undeletes a soft-deleted match. */
export async function storePhoto(photo: ProcessedImage): Promise<string> {
  const { blob, thumb, ...details } = photo
  // A merged duplicate is never reused: its live twin is.
  const existing = await db.photos
    .where('hash')
    .equals(photo.hash)
    .filter((p) => !p.mergedInto)
    .first()
  if (existing) {
    if (existing.deletedAt) {
      await db.photos.update(existing.id, { deletedAt: undefined })
    }
    const hasBytes =
      !!existing.blob || (await hashesHeld(db, [photo.hash])).size > 0
    if (!hasBytes) {
      // Only the details were here; now the bytes are too.
      await keepBytes(db, { hash: photo.hash, blob, thumb })
      await db.photos.update(existing.id, {
        needsUpload: 1,
        needsDownload: undefined,
      })
    }
    return existing.id
  }
  const id = newId()
  await keepBytes(db, { hash: photo.hash, blob, thumb })
  await db.photos.add({ id, ...details, needsUpload: 1 })
  return id
}
