import Dexie, { type Transaction } from 'dexie'
import type { GlazetteDB } from '../db/db'

/**
 * The tables whose rows travel between devices. A photo's row travels, but
 * not its bytes.
 */
export const SYNCED_TABLES = [
  'pieces',
  'entries',
  'glazeApps',
  'glazes',
  'clays',
  'settings',
  'photos',
] as const

/**
 * Fields that stay on this device and never travel in a sync record: the sync
 * mark itself, settings kept per device, and a photo's bytes and transfer
 * flags. A change to only these isn't a change to sync. A write that changes
 * nothing (a `put` of the same row) isn't one either.
 */
export const DEVICE_ONLY_FIELDS: readonly string[] = [
  'dirty',
  'lastBackupAt',
  'persistRequested',
  'blob',
  'thumb',
  'needsUpload',
  'needsDownload',
]

const quietTransactions = new WeakSet<Transaction>()
const noticedTransactions = new WeakSet<Transaction>()
const listenersByDb = new WeakMap<GlazetteDB, Set<() => void>>()

/** A nested transaction is quiet when it, or any transaction around it, is. */
function isQuiet(trans: Transaction): boolean {
  for (let t: Transaction | null | undefined = trans; t; t = t.parent) {
    if (quietTransactions.has(t)) return true
  }
  return false
}

/** Nested transactions commit with the outermost one. */
function outermost(trans: Transaction): Transaction {
  let t = trans
  while (t.parent) t = t.parent
  return t
}

/** Arranges, once per transaction, for the listeners to hear about it after it commits. */
function notice(db: GlazetteDB, trans: Transaction): void {
  const top = outermost(trans)
  if (noticedTransactions.has(top)) return
  noticedTransactions.add(top)
  top.on('complete', () => {
    for (const listener of [...(listenersByDb.get(db) ?? [])]) {
      // Outside the finished transaction, so a listener can start its own.
      Dexie.ignoreTransaction(() => {
        try {
          listener()
        } catch (error) {
          console.error(error)
        }
      })
    }
  })
}

/**
 * Marks every local write to a synced table as waiting to sync (`dirty: 1`)
 * and stamps its change time (`updatedAt`) with now, unless the write gives
 * one itself (a restore keeps the backup's change times). Pieces are never
 * stamped: the app sets their `updatedAt` itself and the shelf is ordered by
 * it. Called once from the database constructor.
 */
export function trackChanges(db: GlazetteDB): void {
  for (const name of SYNCED_TABLES) {
    const table = db.table(name)
    table.hook(
      'creating',
      (
        _key,
        obj: { dirty?: 1; updatedAt?: string; blob?: unknown; needsUpload?: 1 },
        trans,
      ) => {
        if (isQuiet(trans)) return
        obj.dirty = 1
        if (name !== 'pieces' && obj.updatedAt === undefined) {
          obj.updatedAt = new Date().toISOString()
        }
        if (name === 'photos' && obj.blob instanceof Blob) obj.needsUpload = 1
        notice(db, trans)
      },
    )
    table.hook(
      'updating',
      (
        modifications: { updatedAt?: unknown; blob?: unknown },
        _key,
        _obj,
        trans,
      ) => {
        if (isQuiet(trans)) return
        // Bytes given to a photo are waiting to upload, even though `blob`
        // itself isn't a change to sync. Checked before the device-only
        // early return below, which would skip it.
        const gotBytes = name === 'photos' && modifications.blob instanceof Blob
        if (gotBytes) notice(db, trans)
        if (
          Object.keys(modifications).every((k) =>
            DEVICE_ONLY_FIELDS.includes(k),
          )
        ) {
          return gotBytes ? { needsUpload: 1 } : undefined
        }
        notice(db, trans)
        const givesTime = modifications.updatedAt !== undefined
        const marks =
          name === 'pieces' || givesTime
            ? { dirty: 1 }
            : { dirty: 1, updatedAt: new Date().toISOString() }
        return gotBytes ? { ...marks, needsUpload: 1 } : marks
      },
    )
  }
}

/**
 * Runs `fn` in one read-write transaction over the synced tables and the sync
 * state. Its writes land exactly as written: not stamped, not marked, and not
 * reported to `onLocalChange` listeners.
 */
export function quietly<T>(db: GlazetteDB, fn: () => Promise<T>): Promise<T> {
  const tables = [...SYNCED_TABLES.map((name) => db.table(name)), db.syncState]
  // Must be an async function: Dexie keeps the transaction across native
  // awaits only when the scope function itself is async.
  return db.transaction('rw', tables, async () => {
    quietTransactions.add(Dexie.currentTransaction)
    return await fn()
  })
}

/**
 * Calls `listener` once after each committed transaction that changed a
 * synced table, other than quiet ones. Returns a function that unsubscribes.
 */
export function onLocalChange(
  db: GlazetteDB,
  listener: () => void,
): () => void {
  let listeners = listenersByDb.get(db)
  if (!listeners) {
    listeners = new Set()
    listenersByDb.set(db, listeners)
  }
  const subscription = () => listener()
  listeners.add(subscription)
  return () => {
    listeners.delete(subscription)
  }
}
