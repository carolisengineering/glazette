import { useLiveQuery } from 'dexie-react-hooks'
import { db, type GlazetteDB } from '../db/db'
import { SYNCED_TABLES } from './track'

/** How many photos have bytes the server may not hold yet. 0 while loading. */
export function usePhotosWaiting(): number {
  return (
    useLiveQuery(() => db.photos.where('needsUpload').equals(1).count(), []) ??
    0
  )
}

/** What hasn't reached the server: photos to upload, and changed rows in any synced table. */
export async function countWaiting(
  database: GlazetteDB,
): Promise<{ photos: number; changes: number }> {
  const photos = await database.photos.where('needsUpload').equals(1).count()
  let changes = 0
  for (const name of SYNCED_TABLES) {
    changes += await database.table(name).where('dirty').equals(1).count()
  }
  return { photos, changes }
}
