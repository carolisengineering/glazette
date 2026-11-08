// The shared contract between the app and the Worker for syncing records.
// Pure TypeScript: no DOM or Workers types.

export const RECORD_KINDS = [
  'piece',
  'entry',
  'glazeApp',
  'glaze',
  'clay',
  'settings',
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
// MAX_BODY_BYTES. One record (at most MAX_DATA_CHARS of data, so at most
// 3 bytes per character) always fits.
export const PUSH_MAX_BYTES = 512_000
export const PULL_LIMIT = 200
export const MAX_DATA_CHARS = 16_384
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
