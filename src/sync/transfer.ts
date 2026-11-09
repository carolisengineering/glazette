import { MISSING_LIMIT, PHOTO_HASH } from '../../shared/photoProtocol'
import type { GlazetteDB } from '../db/db'
import { bytesOf, keepBytes } from '../photos/bytes'
import { sha256 } from '../photos/hash'
import { type SyncOutcome, SyncStopped } from './engine'
import type { PhotoTransport } from './photoTransport'
import { quietly } from './track'

/**
 * Moves photo bytes after a record sync: uploads what this device has and the
 * server doesn't, then downloads what the synced records describe but this
 * device lacks. Never throws. One photo that fails doesn't stop the others;
 * the result is then 'error', as it is for a photo that can't upload (refused,
 * empty, no thumbnail, bad hash); it keeps waiting and is tried every sync. A
 * photo not on the server yet to download isn't an error. Being offline or signed out stops everything at
 * once, and is the result.
 *
 * Network calls never run inside a transaction. Each write after one is its
 * own `quietly` call, so a transfer never marks a row changed or waiting.
 */
export async function transferPhotos(
  db: GlazetteDB,
  transport: PhotoTransport,
): Promise<SyncOutcome> {
  try {
    // Both run even when a photo in the first failed.
    const uploaded = await upload(db, transport)
    const downloaded = await download(db, transport)
    return uploaded && downloaded ? 'done' : 'error'
  } catch (error) {
    if (error instanceof SyncStopped) return error.reason
    console.error(error)
    return 'error'
  }
}

/**
 * Rethrows what stops the whole transfer. Any other failure, including a
 * SyncStopped('error') from one photo's request, is that photo's alone.
 */
function stopsAll(error: unknown) {
  if (
    error instanceof SyncStopped &&
    (error.reason === 'offline' || error.reason === 'signed-out')
  ) {
    throw error
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

/**
 * Whether a photo that can't upload counts as a failure: only when some row
 * with that hash is live. A deleted photo keeps waiting without an error.
 */
async function isLive(db: GlazetteDB, hash: string) {
  return (
    (await db.photos
      .where('hash')
      .equals(hash)
      .filter((p) => !p.deletedAt)
      .count()) > 0
  )
}

/** True when every photo went well. */
async function upload(db: GlazetteDB, transport: PhotoTransport) {
  let ok = true
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
    try {
      const row = await db.photos.get(id)
      if (!row) continue
      if (!PHOTO_HASH.test(row.hash)) {
        // The server would refuse the whole chunk. The row keeps waiting.
        console.error(`Photo ${id} has a hash that isn't valid; skipped.`)
        if (await isLive(db, row.hash)) ok = false
        continue
      }
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
    } catch (error) {
      stopsAll(error)
      ok = false
      console.error(error)
    }
  }
  await stopWaitingToUpload(db, noBytes)

  const hashes = [...byHash.keys()]
  for (let i = 0; i < hashes.length; i += MISSING_LIMIT) {
    const chunk = hashes.slice(i, i + MISSING_LIMIT)
    let missing: Set<string>
    try {
      missing = new Set(await transport.missing(chunk))
    } catch (error) {
      stopsAll(error)
      ok = false
      console.error(error)
      continue
    }
    // The server already has these.
    await stopWaitingToUpload(
      db,
      chunk.filter((h) => !missing.has(h)).flatMap((h) => byHash.get(h) ?? []),
    )
    for (const hash of chunk) {
      if (!missing.has(hash)) continue
      try {
        const rowIds = byHash.get(hash) ?? []
        // Read again: the bytes may have moved while the network was busy.
        const row = await db.photos.get(rowIds[0])
        const bytes = row && (await bytesOf(db, row))
        if (!bytes) continue
        if (!bytes.thumb) {
          console.error(`Photo ${hash} has no thumbnail; skipped.`)
          if (await isLive(db, hash)) ok = false
          continue
        }
        if (bytes.blob.size === 0 || bytes.thumb.size === 0) {
          console.error(`Photo ${hash} has an empty image; skipped.`)
          if (await isLive(db, hash)) ok = false
          continue
        }
        // Thumbnail first, so a full image on the server nearly always means
        // its thumbnail is there too. Try the full image even if it's refused.
        const thumbStored =
          (await transport.upload(
            hash,
            'thumb',
            bytes.thumb,
            await sha256(bytes.thumb),
          )) === 'stored'
        const fullStored =
          (await transport.upload(hash, 'full', bytes.blob, hash)) === 'stored'
        if (thumbStored && fullStored) await stopWaitingToUpload(db, rowIds)
        else {
          console.error(`The server refused photo ${hash}; will retry later.`)
          if (await isLive(db, hash)) ok = false
        }
      } catch (error) {
        stopsAll(error)
        ok = false
        console.error(error)
      }
    }
  }
  return ok
}

/** True when every photo went well. */
async function download(db: GlazetteDB, transport: PhotoTransport) {
  let ok = true
  const ids = (await db.photos
    .where('needsDownload')
    .equals(1)
    .filter((p) => !p.deletedAt)
    .primaryKeys()) as string[]

  for (const id of ids) {
    try {
      await downloadOne(db, transport, id)
    } catch (error) {
      stopsAll(error)
      ok = false
      console.error(error)
    }
  }
  return ok
}

async function downloadOne(
  db: GlazetteDB,
  transport: PhotoTransport,
  id: string,
) {
  const row = await db.photos.get(id)
  if (!row?.needsDownload || row.deletedAt) return
  if (await bytesOf(db, row)) {
    await quietly(db, () => db.photos.update(id, { needsDownload: undefined }))
    return
  }

  const blob = await transport.download(row.hash, 'full')
  // Not uploaded yet. A later sync picks it up.
  if (!blob) return
  if ((await sha256(blob)) !== row.hash) {
    console.error(`Discarded a download that doesn't match photo ${row.hash}.`)
    return
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
