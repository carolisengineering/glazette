import type { GlazetteDB } from '../db/db'
import type { Photo, PhotoBytes } from '../db/types'
import { quietly } from '../sync/track'

/**
 * A photo's image bytes: from the bytes table by hash, or from the photo's own
 * row if it hasn't moved yet. Undefined when this device doesn't have them.
 */
export async function bytesOf(
  db: GlazetteDB,
  photo: Photo,
): Promise<{ blob: Blob; thumb?: Blob } | undefined> {
  const stored = await db.photoBytes.get(photo.hash)
  if (stored) return { blob: stored.blob, thumb: stored.thumb }
  if (photo.blob) return { blob: photo.blob, thumb: photo.thumb }
  return undefined
}

/** The hashes among these that the bytes table holds. Reads keys only, so no Blob is loaded. */
export async function hashesHeld(
  db: GlazetteDB,
  hashes: string[],
): Promise<Set<string>> {
  const held = await db.photoBytes.where('hash').anyOf(hashes).primaryKeys()
  return new Set(held)
}

/** Adds an entry unless the table already holds its hash: an entry is never overwritten. */
export async function keepBytes(
  db: GlazetteDB,
  entry: PhotoBytes,
): Promise<void> {
  if ((await hashesHeld(db, [entry.hash])).size === 0) {
    await db.photoBytes.add(entry)
  }
}

async function moveRow(db: GlazetteDB, id: string): Promise<void> {
  await quietly(db, async () => {
    // Read again: this is the transaction that has to see the bytes arrive.
    const row = await db.photos.get(id)
    if (!row?.blob) return
    await keepBytes(db, { hash: row.hash, blob: row.blob, thumb: row.thumb })
    await db.photos.update(id, { blob: undefined, thumb: undefined })
  })
}

/** Databases with nothing left to move, until the app next opens. */
const settled = new WeakSet<GlazetteDB>()

/**
 * Moves image bytes off the photo rows that still hold them. Each row is its
 * own short transaction, so a row's bytes leave it only once the table holds
 * that hash, and a row that fails keeps its bytes and is tried again on the
 * next run. Not part of the version upgrade: a long upgrade over hundreds of
 * Blobs could abort, and then the app wouldn't open. Never throws.
 */
export async function moveBytesApart(db: GlazetteDB): Promise<void> {
  if (settled.has(db)) return
  try {
    const ids = await db.photos.filter((p) => !!p.blob).primaryKeys()
    let failed = false
    for (const id of ids) {
      try {
        await moveRow(db, id)
      } catch (error) {
        failed = true
        console.error(`Couldn't move the bytes of photo ${id}.`, error)
      }
    }
    if (!failed) settled.add(db)
  } catch (error) {
    console.error(error)
  }
}
