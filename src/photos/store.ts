import { db, newId } from '../db/db'
import { processImage } from './process'

/** Store a captured image; returns the existing photo's id when the same image is already saved. */
export async function savePhoto(file: File): Promise<string> {
  const { blob, thumb, hash, width, height, takenAt } = await processImage(file)
  const existing = await db.photos.where('hash').equals(hash).first()
  if (existing) return existing.id
  const id = newId()
  await db.photos.add({ id, blob, thumb, hash, width, height, takenAt })
  return id
}
