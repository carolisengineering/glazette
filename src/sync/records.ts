import type { Table } from 'dexie'
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
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
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

/** How a record is named across a batch: its kind and id, as `kind/id`. */
export const recordKey = (record: { kind: unknown; id: unknown }) =>
  `${String(record.kind)}/${String(record.id)}`

export interface ApplyResult {
  applied: number
  skipped: number
  /** The `kind/id` of each skipped record that has a kind and id. */
  skippedKeys: Set<string>
}

/**
 * Writes the records that are newer than (or tie with a dirty copy of) the
 * local row, skipping any this version can't use. Written rows end clean.
 */
export function applyRecords(
  db: GlazetteDB,
  records: unknown[],
): Promise<ApplyResult> {
  return quietly(db, async () => {
    const result: ApplyResult = {
      applied: 0,
      skipped: 0,
      skippedKeys: new Set(),
    }
    for (const record of records) {
      if (
        !isSyncRecord(record) ||
        !ROW_CHECK[record.kind](record.data) ||
        !(await applyOne(db, record))
      ) {
        result.skipped++
        const named = record as { kind?: unknown; id?: unknown } | null
        if (typeof named?.kind === 'string' && typeof named.id === 'string') {
          result.skippedKeys.add(recordKey({ kind: named.kind, id: named.id }))
        }
      } else {
        result.applied++
      }
    }
    return result
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
 * name matches a live one that is, becomes that one. Its details carry over to
 * the account's row (see carriedDetails), everything pointing at it moves to
 * the account's id, and the local duplicate is deleted. A normal
 * tracked write, so the changes sync. A piece that moves to the account's
 * clay changes 1 ms after it last did: past a server copy with the same
 * change time (left by an earlier full sync that stopped partway), still
 * behind any later one, and in the same place on the shelf.
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
            p.updatedAt = justAfter(changedAt(p))
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

/** The ISO time 1 ms after `time`, a valid change time. */
const justAfter = (time: string) => new Date(Date.parse(time) + 1).toISOString()

/**
 * Deletes the local duplicates in one table, first carrying their details onto
 * the account's rows; returns duplicate id -> account id.
 */
async function joinByName(
  table: GlazetteDB['glazes'] | GlazetteDB['clays'],
  accountIds: Set<string>,
): Promise<Map<string, string>> {
  // Read and written as plain rows, so details carry over generically.
  const rows = table as unknown as Table<NamedRow, string>
  const live = await rows.filter((r) => !r.deletedAt).toArray()
  const accountByName = new Map<string, NamedRow>()
  for (const row of live) {
    const key = nameKey(row.name)
    if (accountIds.has(row.id) && !accountByName.has(key)) {
      accountByName.set(key, row)
    }
  }
  const joined = new Map<string, string>()
  const deletedAt = new Date().toISOString()
  for (const row of live) {
    const target = accountByName.get(nameKey(row.name))
    if (accountIds.has(row.id) || !target) continue
    joined.set(row.id, target.id)
    const details = carriedDetails(row, target)
    if (Object.keys(details).length > 0) {
      await rows.update(target.id, details)
      // As stored now, for a second duplicate of the same name.
      Object.assign(target, details, { updatedAt: new Date().toISOString() })
    }
    await rows.update(row.id, { deletedAt })
  }
  return joined
}

type NamedRow = Row & { name: string }

/** Never carried from a local duplicate onto the account's row. */
const NOT_CARRIED = new Set(['id', 'name', 'deletedAt', 'dirty', 'updatedAt'])

/** On a tie, filled in from the local duplicate when the account's is empty. */
const FILLED_ON_TIE = ['notes', 'cone']

const isBlank = (v: unknown) => v === undefined || v === null || v === ''

const isDefaultColor = (v: unknown) =>
  v === undefined ||
  (typeof v === 'string' &&
    v.toLowerCase() === DEFAULT_GLAZE_COLOR.toLowerCase())

/**
 * What a local duplicate adds to the account's row it merges into: all its
 * details when it changed later; on a tie, only what the account's row lacks
 * (empty notes or cone, the default color); nothing when the account's row
 * changed later. The account's name always stays.
 */
function carriedDetails(local: Row, account: Row): Record<string, unknown> {
  const localTime = changedAt(local)
  const accountTime = changedAt(account)
  const details: Record<string, unknown> = {}
  if (localTime > accountTime) {
    for (const [key, value] of Object.entries(local)) {
      if (
        !NOT_CARRIED.has(key) &&
        value !== undefined &&
        account[key] !== value
      )
        details[key] = value
    }
  } else if (localTime === accountTime) {
    for (const key of FILLED_ON_TIE) {
      if (isBlank(account[key]) && !isBlank(local[key]))
        details[key] = local[key]
    }
    if (
      'color' in local &&
      isDefaultColor(account.color) &&
      !isDefaultColor(local.color)
    ) {
      details.color = local.color
    }
  }
  return details
}
