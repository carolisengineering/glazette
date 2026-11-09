import type { GlazetteDB } from '../db/db'
import type { Photo } from '../db/types'
import { changedAt, justAfter } from './records'

/**
 * Photo rows that hold the same image (the same hash) under different ids,
 * as after restoring backups on two devices, become one. The lowest id stays,
 * so devices that merge separately agree. A normal tracked write, so the
 * changes sync. Returns how many rows were merged away.
 *
 * Bytes aren't touched: they're found by hash, so the kept row already has any
 * this device holds. It takes over the wait to upload from its duplicates.
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
      if (!kept.needsUpload && duplicates.some((p) => p.needsUpload)) {
        await db.photos.update(kept.id, { needsUpload: 1 })
      }
      for (const duplicate of duplicates) {
        await db.photos.update(duplicate.id, {
          deletedAt,
          mergedInto: kept.id,
          needsUpload: undefined,
          needsDownload: undefined,
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
