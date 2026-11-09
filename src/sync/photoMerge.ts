import type { GlazetteDB } from '../db/db'
import type { Photo } from '../db/types'
import { changedAt, justAfter } from './records'

const withoutBytes = {
  blob: undefined,
  thumb: undefined,
  needsUpload: undefined,
  needsDownload: undefined,
}

/**
 * Photo rows that hold the same image (the same hash) under different ids,
 * as after restoring backups on two devices, become one. The lowest id stays,
 * so devices that merge separately agree. A normal tracked write, so the
 * changes sync. Returns how many rows were merged away.
 *
 * The kept row gets the bytes before a duplicate loses its own, all in one
 * transaction, so neither row can end up without bytes.
 */
export function mergePhotosByHash(db: GlazetteDB): Promise<number> {
  return db.transaction('rw', [db.photos, db.entries], async () => {
    const groups = new Map<string, Photo[]>()
    const live = await db.photos.filter((p) => !p.deletedAt).toArray()
    for (const photo of live) {
      const group = groups.get(photo.hash)
      if (group) group.push(photo)
      else groups.set(photo.hash, [photo])
    }

    let merged = 0
    const deletedAt = new Date().toISOString()
    for (const group of groups.values()) {
      if (group.length < 2) continue
      group.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      const [kept, ...duplicates] = group
      const donor = duplicates.find((p) => p.blob)
      if (!kept.blob && donor?.blob) {
        await db.photos.update(kept.id, {
          blob: donor.blob,
          thumb: donor.thumb,
          needsDownload: undefined,
        })
      }
      for (const duplicate of duplicates) {
        await db.photos.update(duplicate.id, {
          deletedAt,
          mergedInto: kept.id,
          ...withoutBytes,
        })
        merged++
      }
    }

    // Where each merged-away photo went, this merge's and earlier ones.
    const movedTo = new Map<string, string>()
    const mergedRows = await db.photos.filter((p) => !!p.mergedInto).toArray()
    for (const p of mergedRows) movedTo.set(p.id, p.mergedInto as string)
    const end = (id: string): string => {
      const seen = new Set<string>()
      let at = id
      for (let next = movedTo.get(at); next; next = movedTo.get(at)) {
        if (seen.has(at)) break
        seen.add(at)
        at = next
      }
      return at
    }

    // A photo merged away on another device may still hold bytes here. They
    // move to where it went if that row has none, and go only once that row
    // holds the same bytes (the same hash).
    for (const row of mergedRows) {
      if (!row.blob) continue
      const target = await db.photos.get(end(row.id))
      if (!target || target.deletedAt || target.hash !== row.hash) continue
      if (!target.blob) {
        await db.photos.update(target.id, {
          blob: row.blob,
          thumb: row.thumb,
          needsDownload: undefined,
        })
      }
      await db.photos.update(row.id, withoutBytes)
    }

    // Steps follow every merge to its end.
    await db.entries
      .filter((e) => e.photoId !== undefined && movedTo.has(e.photoId))
      .modify((e) => {
        e.photoId = end(e.photoId as string)
        e.updatedAt = justAfter(changedAt(e))
      })
    return merged
  })
}
