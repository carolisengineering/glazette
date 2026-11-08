import {
  isSyncRecord,
  PUSH_LIMIT,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from '../../shared/syncProtocol'
import type { GlazetteDB } from '../db/db'
import {
  applyRecords,
  clearDirty,
  markAllDirty,
  mergeByName,
  readDirty,
} from './records'
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
 * One sync with the account: pull and apply what changed there, merge
 * same-named glazes and clays on the first sync for this account, then push
 * what changed here. Never throws.
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
  for (;;) {
    const page = await transport.pull(cursor)
    if (page.more && page.cursor <= cursor) {
      throw new Error(`Sync pull is stuck at cursor ${cursor}`)
    }
    if (full) {
      await applyRecords(db, page.records)
      for (const record of page.records) {
        if (
          isSyncRecord(record) &&
          (record.kind === 'glaze' || record.kind === 'clay')
        ) {
          accountIds[record.kind].add(record.id)
        }
      }
    } else {
      await quietly(db, async () => {
        await applyRecords(db, page.records)
        await db.syncState.update('state', { cursor: page.cursor })
      })
    }
    cursor = page.cursor
    if (!page.more) break
  }

  // 3. The first sync for this account joins same-named glazes and clays.
  if (full) await mergeByName(db, accountIds)

  // 4. Push what changed here. A row edited while its push is in flight keeps
  // its mark for the next sync. The server's copy is applied before the mark
  // is cleared, so on a tie the server's copy wins over the dirty row.
  const dirty = await readDirty(db)
  for (let i = 0; i < dirty.length; i += PUSH_LIMIT) {
    const chunk = dirty.slice(i, i + PUSH_LIMIT)
    const { rejected } = await transport.push(chunk)
    await quietly(db, async () => {
      await applyRecords(db, rejected)
      await clearDirty(db, chunk)
    })
  }

  // 5. Done.
  await db.syncState.put({
    id: 'state',
    account,
    cursor,
    lastSyncedAt: new Date().toISOString(),
  })
}
