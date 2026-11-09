import type { GlazetteDB } from '../db/db'
import type { PhotoBytes } from '../db/types'

interface Bytes {
  blob?: Blob
  thumb?: Blob
}

/**
 * fake-indexeddb hands stored Blobs back as plain objects with the bytes lost,
 * which a real browser never does. So a test that needs the bytes remembers
 * each Blob as it's written and puts it back when it's read, as a browser
 * would return it. Call `watch` on each database, again after reopening one.
 */
export function realBlobs() {
  const onRows = new Map<string, Bytes>()
  const inTable = new Map<string, PhotoBytes>()
  return {
    /** The entries written to the bytes table, with their real Blobs, by hash. */
    inTable,
    watch(db: GlazetteDB) {
      db.photos.hook('creating', (id, row) => {
        if (row.blob) {
          onRows.set(id as string, { blob: row.blob, thumb: row.thumb })
        }
      })
      // Dexie also runs these hooks on the undefined of a read that found nothing.
      db.photos.hook('reading', (row) => {
        const real = row && onRows.get(row.id)
        return real && row.blob ? { ...row, ...real } : row
      })
      db.photoBytes.hook('creating', (_hash, entry) => {
        inTable.set(entry.hash, { ...entry })
      })
      db.photoBytes.hook('reading', (entry) =>
        entry ? (inTable.get(entry.hash) ?? entry) : entry,
      )
    },
  }
}
