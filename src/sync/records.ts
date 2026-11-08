import {
  CHANGED_AT,
  EPOCH,
  isSyncRecord,
  type RecordKind,
  type SyncRecord,
} from '../../shared/syncProtocol'
import type { GlazetteDB } from '../db/db'
import {
  isClayRow,
  isEntryRow,
  isGlazeRow,
  isLayerRow,
  isPieceRow,
  isSettingsRow,
  nameKey,
  withValidColor,
} from '../db/rowChecks'
import { quietly, type SYNCED_TABLES } from './track'

type TableName = (typeof SYNCED_TABLES)[number]

const TABLE_OF: Record<RecordKind, TableName> = {
  piece: 'pieces',
  entry: 'entries',
  glazeApp: 'glazeApps',
  glaze: 'glazes',
  clay: 'clays',
  settings: 'settings',
}

const KINDS = Object.keys(TABLE_OF) as RecordKind[]

const ROW_CHECK: Record<RecordKind, (row: unknown) => boolean> = {
  piece: isPieceRow,
  entry: isEntryRow,
  glazeApp: isLayerRow,
  glaze: isGlazeRow,
  clay: isClayRow,
  settings: (row) =>
    isSettingsRow(row) && (row as { id: unknown }).id === 'app',
}

/** Fields that stay on this device. */
const DEVICE_ONLY = ['dirty', 'lastBackupAt', 'persistRequested']

type Row = Record<string, unknown> & {
  id: string
  updatedAt?: string
  deletedAt?: string
}

function normalized(v: unknown): string {
  if (typeof v !== 'string') return EPOCH
  if (CHANGED_AT.test(v)) return v
  const time = new Date(v).getTime()
  return Number.isNaN(time) ? EPOCH : new Date(time).toISOString()
}

/** A row's change time: the later of updatedAt and deletedAt. */
export function changedAt(row: {
  updatedAt?: string
  deletedAt?: string
}): string {
  const updated = normalized(row.updatedAt)
  const deleted =
    row.deletedAt === undefined ? EPOCH : normalized(row.deletedAt)
  if (deleted > updated) return deleted
  return updated
}

/** A row as a sync record, without the fields that stay on this device. */
export function toRecord(kind: RecordKind, row: Row): SyncRecord {
  const data = { ...row }
  for (const key of DEVICE_ONLY) delete data[key]
  return { kind, id: row.id, changedAt: changedAt(row), data }
}

/**
 * Every row waiting to sync, as records. A row that can't be sent (too big,
 * say) is skipped with a warning and stays dirty.
 */
export async function readDirty(db: GlazetteDB): Promise<SyncRecord[]> {
  const records: SyncRecord[] = []
  for (const kind of KINDS) {
    const rows = (await db
      .table(TABLE_OF[kind])
      .where('dirty')
      .equals(1)
      .toArray()) as Row[]
    for (const row of rows) {
      const record = toRecord(kind, row)
      if (isSyncRecord(record)) records.push(record)
      else console.warn(`Not syncing ${kind} ${row.id}: it can't be sent`)
    }
  }
  return records
}

/** Marks every row to be sent. Change times stay as they are. */
export function markAllDirty(db: GlazetteDB): Promise<void> {
  return quietly(db, async () => {
    for (const kind of KINDS) {
      await db.table(TABLE_OF[kind]).toCollection().modify({ dirty: 1 })
    }
  })
}

/**
 * Clears the mark on rows that were pushed, unless the row changed since it
 * was read: a newer edit stays marked for the next sync.
 */
export function clearDirty(
  db: GlazetteDB,
  pushed: SyncRecord[],
): Promise<void> {
  return quietly(db, async () => {
    for (const record of pushed) {
      const table = db.table(TABLE_OF[record.kind])
      const row = (await table.get(record.id)) as Row | undefined
      if (row && changedAt(row) === record.changedAt) {
        await table.update(record.id, { dirty: undefined })
      }
    }
  })
}

/**
 * Writes the records that are newer than (or tie with a dirty copy of) the
 * local row, skipping any this version can't use. Written rows end clean.
 */
export function applyRecords(
  db: GlazetteDB,
  records: unknown[],
): Promise<{ applied: number; skipped: number }> {
  return quietly(db, async () => {
    let applied = 0
    let skipped = 0
    for (const record of records) {
      if (
        !isSyncRecord(record) ||
        !ROW_CHECK[record.kind](record.data) ||
        !(await applyOne(db, record))
      ) {
        skipped++
      } else {
        applied++
      }
    }
    return { applied, skipped }
  })
}

/** True when the record was written, false when the local row stays. */
async function applyOne(db: GlazetteDB, record: SyncRecord): Promise<boolean> {
  const table = db.table(TABLE_OF[record.kind])
  const mine = (await table.get(record.id)) as Row | undefined
  if (mine) {
    const local = changedAt(mine)
    const wins =
      record.changedAt > local || (record.changedAt === local && mine.dirty)
    if (!wins) return false
  }
  let row: Row = { ...record.data } as Row
  delete row.dirty
  if (record.kind === 'glaze')
    row = withValidColor(row as Row & { color?: unknown })
  if (record.kind === 'settings' && mine) {
    for (const key of ['lastBackupAt', 'persistRequested']) {
      delete row[key]
      if (mine[key] !== undefined) row[key] = mine[key]
    }
  }
  await table.put(row)
  return true
}

/**
 * First sign-in: a live local glaze or clay that isn't the account's, whose
 * name matches a live one that is, becomes that one. Everything pointing at it
 * moves to the account's id and the local duplicate is deleted. A normal
 * tracked write, so the changes sync. Pieces keep their updatedAt.
 */
export function mergeByName(
  db: GlazetteDB,
  accountIds: { glaze: Set<string>; clay: Set<string> },
): Promise<void> {
  return db.transaction(
    'rw',
    [db.glazes, db.clays, db.glazeApps, db.pieces, db.settings],
    async () => {
      const glazes = await joinByName(db.glazes, accountIds.glaze)
      const clays = await joinByName(db.clays, accountIds.clay)
      if (glazes.size > 0) {
        await db.glazeApps
          .filter((a) => glazes.has(a.glazeId))
          .modify((a) => {
            a.glazeId = glazes.get(a.glazeId) as string
          })
      }
      if (clays.size > 0) {
        await db.pieces
          .filter((p) => p.clayId !== undefined && clays.has(p.clayId))
          .modify((p) => {
            p.clayId = clays.get(p.clayId as string)
          })
        const settings = await db.settings.get('app')
        const joined = settings?.defaultClayId
          ? clays.get(settings.defaultClayId)
          : undefined
        if (joined) await db.settings.update('app', { defaultClayId: joined })
      }
    },
  )
}

/** Deletes the local duplicates in one table; returns duplicate id -> account id. */
async function joinByName(
  table: GlazetteDB['glazes'] | GlazetteDB['clays'],
  accountIds: Set<string>,
): Promise<Map<string, string>> {
  const live = await table.filter((r) => !r.deletedAt).toArray()
  const accountByName = new Map<string, string>()
  for (const row of live) {
    if (accountIds.has(row.id) && !accountByName.has(nameKey(row.name))) {
      accountByName.set(nameKey(row.name), row.id)
    }
  }
  const joined = new Map<string, string>()
  for (const row of live) {
    const target = accountByName.get(nameKey(row.name))
    if (!accountIds.has(row.id) && target) joined.set(row.id, target)
  }
  const deletedAt = new Date().toISOString()
  for (const id of joined.keys()) {
    await (table as GlazetteDB['clays']).update(id, { deletedAt })
  }
  return joined
}
