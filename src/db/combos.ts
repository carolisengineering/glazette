import { storePhoto } from '../photos/store'
import type { SwatchImage } from '../photos/swatchImage'
import { changeTime } from '../sync/records'
import { db } from './db'
import { releaseSwatch } from './swatch'

const MASK = 0xffffffffffffffffn
const PRIME = 0x100000001b3n
const BASIS = 0xcbf29ce484222325n

function fnv1a64(text: string, basis: bigint): bigint {
  let hash = basis
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK
  }
  return hash
}

const hex16 = (n: bigint): string => n.toString(16).padStart(16, '0')

/**
 * A stable id for an ordered stack of glaze ids: the same layers in the same
 * order always give the same id, on every device.
 */
export function comboId(layers: string[]): string {
  const text = layers.join('|')
  const a = fnv1a64(text, BASIS)
  const b = fnv1a64(text, BASIS ^ 0x9e3779b97f4a7c15n)
  return `combo-${hex16(a)}${hex16(b)}`
}

/** A stack is 2 or 3 glaze ids, none empty. */
export function isValidStack(layers: string[]): boolean {
  return (
    (layers.length === 2 || layers.length === 3) && layers.every((l) => !!l)
  )
}

/**
 * Saves the swatch photo for a stack. Saving a stack again replaces its photo
 * (releasing the old one) and brings a deleted combo back, dated past the
 * row's last change so it wins over that copy. Returns the id.
 */
export async function saveCombo(
  layers: string[],
  image: SwatchImage,
): Promise<string> {
  const id = comboId(layers)
  await db.transaction(
    'rw',
    db.combos,
    db.glazes,
    db.photos,
    db.photoBytes,
    async () => {
      const existing = await db.combos.get(id)
      const previous = existing?.swatchPhotoId
      const now = new Date().toISOString()
      const { color: _color, ...rest } = image
      const photoId = await storePhoto(rest)
      await db.photos.update(photoId, { swatch: 1 })
      await db.combos.put({
        id,
        layers,
        swatchPhotoId: photoId,
        createdAt: existing?.createdAt ?? now,
        deletedAt: undefined,
        purgedAt: undefined,
        ...(existing ? { updatedAt: changeTime(existing, now) } : {}),
      })
      if (previous && previous !== photoId) {
        await releaseSwatch(db, previous, now)
      }
    },
  )
  return id
}

/** Soft-deletes a combo and releases its swatch photo. */
export async function deleteCombo(id: string): Promise<void> {
  await db.transaction('rw', db.combos, db.glazes, db.photos, async () => {
    const combo = await db.combos.get(id)
    if (!combo) return
    const now = new Date().toISOString()
    await db.combos.update(id, { deletedAt: now })
    await releaseSwatch(db, combo.swatchPhotoId, now)
  })
}
