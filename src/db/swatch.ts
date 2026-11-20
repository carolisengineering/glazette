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
 * Releases (soft-deletes) a swatch photo once no live glaze or combo links it. Does
 * nothing when the photo is missing, purged or already deleted. The caller has
 * already moved the link off the glaze. Call inside a transaction that
 * includes `db.glazes`, `db.combos` and `db.photos`. Says whether it released
 * the photo.
 */
export async function releaseSwatch(
  db: GlazetteDB,
  photoId: string,
  now: string,
): Promise<boolean> {
  const photo = await db.photos.get(photoId)
  if (!photo || photo.deletedAt || photo.purgedAt) return false
  const glazesUsing = await db.glazes
    .filter((g) => g.swatchPhotoId === photoId && !g.deletedAt)
    .count()
  if (glazesUsing > 0) return false
  const combosUsing = await db.combos
    .filter((c) => c.swatchPhotoId === photoId && !c.deletedAt)
    .count()
  if (combosUsing > 0) return false
  await db.photos.update(photoId, {
    deletedAt: now,
    updatedAt: changeTime(photo, now),
  })
  return true
}

/** The ids of swatch photos that live glazes and combos link. */
export async function liveSwatchIds(db: GlazetteDB): Promise<Set<string>> {
  const ids = new Set<string>()
  await db.glazes
    .filter((g) => !g.deletedAt && !!g.swatchPhotoId)
    .each((g) => {
      ids.add(g.swatchPhotoId as string)
    })
  await db.combos
    .filter((c) => !c.deletedAt)
    .each((c) => {
      ids.add(c.swatchPhotoId)
    })
  return ids
}

/**
 * Adds or updates a glaze, and its swatch as `swatch` says. A replaced or
 * removed swatch photo is released. Returns the glaze id.
 */
export async function saveGlaze(
  input: Omit<Glaze, 'id' | 'deletedAt' | 'swatchPhotoId'> & { id?: string },
  swatch: SwatchEdit,
): Promise<string> {
  const id = input.id ?? newId()
  await db.transaction(
    'rw',
    db.glazes,
    db.combos,
    db.photos,
    db.photoBytes,
    async () => {
      const existing = input.id ? await db.glazes.get(id) : undefined
      const previous = existing?.swatchPhotoId
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
      if (existing) {
        await db.glazes.update(id, fields)
      } else {
        await db.glazes.add({ ...input, ...fields, id } as Glaze)
      }
      if (previous && previous !== newPhotoId) {
        await releaseSwatch(db, previous, now)
      }
    },
  )
  return id
}

/** Soft-deletes a glaze and releases its swatch photo. */
export async function deleteGlaze(id: string): Promise<void> {
  await db.transaction('rw', db.glazes, db.combos, db.photos, async () => {
    const glaze = await db.glazes.get(id)
    if (!glaze) return
    const now = new Date().toISOString()
    await db.glazes.update(id, { deletedAt: now })
    if (glaze.swatchPhotoId) await releaseSwatch(db, glaze.swatchPhotoId, now)
  })
}
