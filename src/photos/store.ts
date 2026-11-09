import { db, newId } from '../db/db'
import type { ProcessedImage } from './process'

/** Must be called inside an open Dexie transaction that includes `db.photos`; dedupes by hash and undeletes a soft-deleted match. */
export async function storePhoto(photo: ProcessedImage): Promise<string> {
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
    if (!existing.blob) {
      // Only the details were here; now the bytes are too.
      await db.photos.update(existing.id, {
        blob: photo.blob,
        thumb: photo.thumb,
        needsDownload: undefined,
      })
    }
    return existing.id
  }
  const id = newId()
  await db.photos.add({ id, ...photo })
  return id
}
