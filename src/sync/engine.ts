import {
  isSyncRecord,
  PUSH_LIMIT,
  PUSH_MAX_BYTES,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from '../../shared/syncProtocol'
import type { GlazetteDB } from '../db/db'
import { captureError } from '../telemetry/telemetry'
import { type DroppedPhoto, releaseDropped } from './droppedPhotos'
import { mergePhotosByHash } from './photoMerge'
import {
  applyRecords,
  clearDirty,
  markAllDirty,
  mergeByName,
  readDirty,
  recordKey,
} from './records'
import { settlePhotos } from './settlePhotos'
import { quietly } from './track'

export type StopReason = 'offline' | 'signed-out' | 'error'

/** A sync that can't go on, and why. Thrown by a transport. */
export class SyncStopped extends Error {
  readonly reason: StopReason

  constructor(reason: StopReason) {
    super(`Sync stopped: ${reason}`)
    this.name = 'SyncStopped'
    this.reason = reason
  }
}

/** How the device talks to the sync server. Either method throws SyncStopped. */
export interface Transport {
  push(records: SyncRecord[]): Promise<PushResponse>
  pull(since: number): Promise<PullResponse>
}

export type SyncOutcome = 'done' | StopReason

/**
 * One sync with the account: pull and apply what changed there, send each
 * photo a step's losing copy showed to Recently Deleted, merge same-named
 * glazes and clays on the first sync for this account, merge photos of the
 * same image, settle photos against the steps that show them, then push what
 * changed here. Never throws.
 */
export async function syncOnce(
  db: GlazetteDB,
  transport: Transport,
  account: string,
): Promise<SyncOutcome> {
  try {
    await run(db, transport, account)
    return 'done'
  } catch (error) {
    if (error instanceof SyncStopped) return error.reason
    console.error(error)
    captureError(error)
    return 'error'
  }
}

async function run(
  db: GlazetteDB,
  transport: Transport,
  account: string,
): Promise<void> {
  // 1. A device that hasn't finished a sync for this account sends everything.
  const state = await db.syncState.get('state')
  const full = !state || state.account !== account
  if (full) await markAllDirty(db)
  let cursor = full ? 0 : state.cursor

  // 2. Pull every page. An incremental sync keeps its place page by page; a
  // full one starts over until it completes.
  const accountIds = { glaze: new Set<string>(), clay: new Set<string>() }
  const dropped: DroppedPhoto[] = []
  for (;;) {
    const page = await transport.pull(cursor)
    if (page.more && page.cursor <= cursor) {
      throw new Error(`Sync pull is stuck at cursor ${cursor}`)
    }
    if (full) {
      dropped.push(...(await applyRecords(db, page.records)).dropped)
      for (const record of page.records) {
        if (
          isSyncRecord(record) &&
          (record.kind === 'glaze' || record.kind === 'clay')
        ) {
          accountIds[record.kind].add(record.id)
        }
      }
    } else {
      const applied = await quietly(db, async () => {
        const result = await applyRecords(db, page.records)
        await db.syncState.update('state', { cursor: page.cursor })
        return result
      })
      dropped.push(...applied.dropped)
    }
    cursor = page.cursor
    if (!page.more) break
  }

  // 3. The first sync for this account joins same-named glazes and clays.
  if (full) await mergeByName(db, accountIds)

  // A photo that one copy of a step showed and the kept copy doesn't goes to
  // Recently Deleted, once the whole pull is in so a step later in it that
  // shows the photo keeps it.
  await releaseDropped(db, dropped)

  // The same image under two ids becomes one photo, so its changes are in
  // the push below.
  await mergePhotosByHash(db)
  // With the whole pull in, each photo follows the steps that show it: a
  // deleted step's photo is deleted, and a photo a live step shows comes back.
  // A purged photo a live step still shows comes back as a new photo, when
  // this device holds its bytes. Steps push before photos, so a removal pulled here arrives with its step's
  // change, and this doesn't undo it.
  await settlePhotos(db)

  // 4. Push what changed here. A row edited while its push is in flight keeps
  // its mark for the next sync. The server's copy is applied before the mark
  // is cleared, so on a tie the server's copy wins over the dirty row. A row
  // whose server copy this version can't use keeps its mark too, so a later
  // version applies that copy.
  for (const chunk of inPushes(await readDirty(db))) {
    const { rejected } = await transport.push(chunk)
    const kept = await quietly(db, async () => {
      const result = await applyRecords(db, rejected)
      await clearDirty(
        db,
        chunk.filter((record) => !result.skippedKeys.has(recordKey(record))),
      )
      return result
    })
    // A rejected step can drop a photo too. Tracked, so the next sync sends
    // the delete.
    await releaseDropped(db, kept.dropped)
  }

  // 5. Done.
  await db.syncState.put({
    id: 'state',
    account,
    cursor,
    lastSyncedAt: new Date().toISOString(),
  })
}

const utf8 = new TextEncoder()

/**
 * Splits records into pushes of at most PUSH_LIMIT records and at most
 * PUSH_MAX_BYTES bytes as UTF-8 JSON, the way the server counts its limit.
 * A record that can be sent always fits on its own.
 */
function inPushes(records: SyncRecord[]): SyncRecord[][] {
  const pushes: SyncRecord[][] = []
  let current: SyncRecord[] = []
  let bytes = 2 // the array's brackets
  for (const record of records) {
    const size = utf8.encode(JSON.stringify(record)).length
    // A comma before every record but the first.
    const full =
      current.length >= PUSH_LIMIT || bytes + 1 + size > PUSH_MAX_BYTES
    if (current.length > 0 && full) {
      pushes.push(current)
      current = []
      bytes = 2
    }
    bytes += (current.length > 0 ? 1 : 0) + size
    current.push(record)
  }
  if (current.length > 0) pushes.push(current)
  return pushes
}
