import { MISSING_LIMIT } from '../../shared/photoProtocol'
import type { GlazetteDB } from '../db/db'
import { bytesOf, keepBytes } from '../photos/bytes'
import { sha256 } from '../photos/hash'
import { type SyncOutcome, SyncStopped } from './engine'
import type { PhotoTransport } from './photoTransport'
import { quietly } from './track'

/**
 * Moves photo bytes after a record sync: uploads what this device has and the
 * server doesn't, then downloads what the synced records describe but this
 * device lacks. Never throws.
 *
 * Network calls never run inside a transaction. Each write after one is its
 * own `quietly` call, so a transfer never marks a row changed or waiting.
 */
export async function transferPhotos(
  db: GlazetteDB,
  transport: PhotoTransport,
): Promise<SyncOutcome> {
  try {
    await upload(db, transport)
    await download(db, transport)
    return 'done'
  } catch (error) {
    if (error instanceof SyncStopped) return error.reason
    console.error(error)
    return 'error'
  }
}

/** Takes `needsUpload` off these rows, if they still exist. */
function stopWaitingToUpload(db: GlazetteDB, ids: string[]) {
  return quietly(db, async () => {
    for (const id of ids) {
      if (await db.photos.get(id)) {
        await db.photos.update(id, { needsUpload: undefined })
      }
    }
  })
}

async function upload(db: GlazetteDB, transport: PhotoTransport) {
  // Deleted photos included: a restore (S4) brings them back, bytes and all.
  const ids = (await db.photos
    .where('needsUpload')
    .equals(1)
    .primaryKeys()) as string[]

  // Ids by hash, for the rows that have bytes. One without just stops waiting,
  // unless its image is still on another row that failed to move: the next
  // move puts it in the table, and this row uploads it then.
  const byHash = new Map<string, string[]>()
  const noBytes: string[] = []
  for (const id of ids) {
    const row = await db.photos.get(id)
    if (!row) continue
    if (await bytesOf(db, row)) {
      byHash.set(row.hash, [...(byHash.get(row.hash) ?? []), id])
    } else if (
      (await db.photos
        .where('hash')
        .equals(row.hash)
        .filter((p) => !!p.blob)
        .count()) === 0
    ) {
      noBytes.push(id)
    }
  }
  await stopWaitingToUpload(db, noBytes)

  const hashes = [...byHash.keys()]
  for (let i = 0; i < hashes.length; i += MISSING_LIMIT) {
    const chunk = hashes.slice(i, i + MISSING_LIMIT)
    const missing = new Set(await transport.missing(chunk))
    // The server already has these.
    await stopWaitingToUpload(
      db,
      chunk.filter((h) => !missing.has(h)).flatMap((h) => byHash.get(h) ?? []),
    )
    for (const hash of chunk) {
      if (!missing.has(hash)) continue
      const rowIds = byHash.get(hash) ?? []
      // Read again: the bytes may have moved while the network was busy.
      const row = await db.photos.get(rowIds[0])
      const bytes = row && (await bytesOf(db, row))
      if (!bytes?.thumb) continue
      const stored =
        (await transport.upload(hash, 'full', bytes.blob, hash)) === 'stored' &&
        (await transport.upload(
          hash,
          'thumb',
          bytes.thumb,
          await sha256(bytes.thumb),
        )) === 'stored'
      if (stored) await stopWaitingToUpload(db, rowIds)
      else console.error(`The server refused photo ${hash}; will retry later.`)
    }
  }
}

async function download(db: GlazetteDB, transport: PhotoTransport) {
  const ids = (await db.photos
    .where('needsDownload')
    .equals(1)
    .filter((p) => !p.deletedAt)
    .primaryKeys()) as string[]

  for (const id of ids) {
    const row = await db.photos.get(id)
    if (!row?.needsDownload || row.deletedAt) continue
    if (await bytesOf(db, row)) {
      await quietly(db, () =>
        db.photos.update(id, { needsDownload: undefined }),
      )
      continue
    }

    const blob = await transport.download(row.hash, 'full')
    // Not uploaded yet. A later sync picks it up.
    if (!blob) continue
    if ((await sha256(blob)) !== row.hash) {
      console.error(
        `Discarded a download that doesn't match photo ${row.hash}.`,
      )
      continue
    }
    const thumb = (await transport.download(row.hash, 'thumb')) ?? blob

    await quietly(db, async () => {
      await keepBytes(db, { hash: row.hash, blob, thumb })
      await db.photos
        .where('hash')
        .equals(row.hash)
        .modify({ needsDownload: undefined })
    })
  }
}
