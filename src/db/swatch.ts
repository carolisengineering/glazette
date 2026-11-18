import { storePhoto } from '../photos/store'
import type { SwatchImage } from '../photos/swatchImage'
import { changeTime } from '../sync/records'
import type { GlazetteDB } from './db'
import { db, newId } from './db'
import type { Glaze } from './types'

/** What a save does to the glaze's swatch: leave it, replace it, or take it away. */
export type SwatchEdit =
  | { kind: 'keep' }
  | { kind: 'set'; image: SwatchImage }
  | { kind: 'remove' }

/**
 * Sends a swatch photo to Recently Deleted once no live glaze links it. Does
 * nothing when the photo is missing, purged or already deleted. The caller has
 * already moved the link off the glaze. Call inside a transaction that
 * includes `db.glazes` and `db.photos`.
 */
export async function releaseSwatch(
  db: GlazetteDB,
  photoId: string,
  now: string,
): Promise<void> {
  const photo = await db.photos.get(photoId)
  if (!photo || photo.deletedAt || photo.purgedAt) return
  const stillUsed = await db.glazes
    .filter((g) => g.swatchPhotoId === photoId && !g.deletedAt)
    .count()
  if (stillUsed > 0) return
  await db.photos.update(photoId, {
    deletedAt: now,
    updatedAt: changeTime(photo, now),
  })
}

/** The ids of swatch photos that live glazes link. */
export async function liveSwatchIds(db: GlazetteDB): Promise<Set<string>> {
  const ids = new Set<string>()
  await db.glazes
    .filter((g) => !g.deletedAt && !!g.swatchPhotoId)
    .each((g) => {
      ids.add(g.swatchPhotoId as string)
    })
  return ids
}

/**
 * Adds or updates a glaze, and its swatch as `swatch` says. A replaced or
 * removed swatch photo goes to Recently Deleted. Returns the glaze id.
 */
export async function saveGlaze(
  input: Omit<Glaze, 'id' | 'deletedAt' | 'swatchPhotoId'> & { id?: string },
  swatch: SwatchEdit,
): Promise<string> {
  const id = input.id ?? newId()
  await db.transaction('rw', db.glazes, db.photos, db.photoBytes, async () => {
    const previous = input.id
      ? (await db.glazes.get(id))?.swatchPhotoId
      : undefined
    const now = new Date().toISOString()
    let fields: Partial<Glaze> = { ...input }
    let newPhotoId = previous
    if (swatch.kind === 'set') {
      const { color, ...image } = swatch.image
      newPhotoId = await storePhoto(image)
      await db.photos.update(newPhotoId, { swatch: 1 })
      fields = { ...fields, swatchPhotoId: newPhotoId, color }
    } else if (swatch.kind === 'remove') {
      newPhotoId = undefined
      fields = { ...fields, swatchPhotoId: undefined }
    }
    if (input.id && (await db.glazes.get(id))) {
      await db.glazes.update(id, fields)
    } else {
      await db.glazes.add({ ...input, ...fields, id } as Glaze)
    }
    if (previous && previous !== newPhotoId) {
      await releaseSwatch(db, previous, now)
    }
  })
  return id
}

/** Soft-deletes a glaze and sends its swatch photo to Recently Deleted. */
export async function deleteGlaze(id: string): Promise<void> {
  await db.transaction('rw', db.glazes, db.photos, async () => {
    const glaze = await db.glazes.get(id)
    if (!glaze) return
    const now = new Date().toISOString()
    await db.glazes.update(id, { deletedAt: now })
    if (glaze.swatchPhotoId) await releaseSwatch(db, glaze.swatchPhotoId, now)
  })
}
