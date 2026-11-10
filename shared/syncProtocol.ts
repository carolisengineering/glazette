// The shared contract between the app and the Worker for syncing records.
// Pure TypeScript: no DOM or Workers types.

export const RECORD_KINDS = [
  'piece',
  'entry',
  'glazeApp',
  'glaze',
  'clay',
  'settings',
  // Last, so a push sends a step's change before its photo's.
  'photo',
] as const

export type RecordKind = (typeof RECORD_KINDS)[number]

export interface SyncRecord {
  kind: RecordKind
  id: string
  // ISO time of the record's latest change.
  changedAt: string
  // The record itself. data.id always equals id.
  data: Record<string, unknown>
}

export const PUSH_LIMIT = 100
// The largest request body the server takes.
export const MAX_BODY_BYTES = 1024 * 1024
// A push's records, as UTF-8 JSON, stay under this many bytes, well inside
// MAX_BODY_BYTES. One record always fits: at most MAX_DATA_CHARS of data at
// no more than 3 bytes per character, about 197 KB.
export const PUSH_MAX_BYTES = 512_000
export const PULL_LIMIT = 200
// The most a record's data may hold, as JSON characters. Room for very long notes.
export const MAX_DATA_CHARS = 65_536
export const RECORD_ID = /^[A-Za-z0-9-]{1,64}$/
export const CHANGED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const EPOCH = '1970-01-01T00:00:00.000Z'

export interface PushBody {
  records: SyncRecord[]
}

// The server's current copy of every pushed record it didn't take.
export interface PushResponse {
  rejected: SyncRecord[]
}

// Kinds that expire 30 days after the server first hears of their delete.
// Glazes and clays never expire: old layers and pieces still show their names.
export const EXPIRING_KINDS = ['piece', 'entry', 'glazeApp', 'photo'] as const
export const RETENTION_DAYS = 30
// The most items the recently deleted list returns.
export const DELETED_LIMIT = 500

export interface DeletedItem {
  kind: 'piece' | 'photo'
  id: string
  // ISO time the server first heard of the delete.
  heardAt: string
}

export interface DeletedResponse {
  items: DeletedItem[]
}

// A stub is what stays of a record after the server purges it.
export function isStubData(data: Record<string, unknown>): boolean {
  return typeof data.purgedAt === 'string'
}

export interface PullResponse {
  records: SyncRecord[]
  // The last seq returned, or the requested since when none.
  cursor: number
  // True when the page was full, so there may be more.
  more: boolean
}

// Checks the envelope only, not what is inside data.
export function isSyncRecord(v: unknown): v is SyncRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!(RECORD_KINDS as readonly unknown[]).includes(r.kind)) return false
  if (typeof r.id !== 'string' || !RECORD_ID.test(r.id)) return false
  if (typeof r.changedAt !== 'string' || !CHANGED_AT.test(r.changedAt))
    return false
  const data = r.data
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return false
  if ((data as Record<string, unknown>).id !== r.id) return false
  return JSON.stringify(data).length <= MAX_DATA_CHARS
}
