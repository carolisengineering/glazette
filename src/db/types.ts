export type Stage = 'thrown' | 'trimmed' | 'bisqued' | 'glazed' | 'fired'

export interface Piece {
  id: string
  name?: string // optional – "Untitled bowl" fallback
  form?: 'mug' | 'bowl' | 'vase' | 'plate' | 'jar' | 'other'
  clayId?: string
  lost?: boolean
  notes?: string
  createdAt: string // ISO date
  updatedAt: string
  deletedAt?: string // soft delete (tombstone for v2 sync)
  purgedAt?: string // removed for good by the server; only a stub is left there
  dirty?: 1 // changed here since the last sync
}
// Current stage is derived: the stage of the piece's latest StageEntry.

export interface StageEntry {
  id: string
  pieceId: string
  stage: Stage
  photoId?: string
  note?: string // e.g. "Cone 04", "2 dips"
  date?: string // Photo date, a date the user entered, or none
  deletedAt?: string
  purgedAt?: string // removed for good by the server; only a stub is left there
  updatedAt?: string // stamped on every local change
  dirty?: 1 // changed here since the last sync
}

export interface GlazeApplication {
  id: string
  entryId: string // the Glazed StageEntry this belongs to
  pieceId: string
  glazeId: string
  order: number // layering order
  dips?: number
  method?: 'dip' | 'brush' | 'pour' | 'spray'
  note?: string // "top half only", "brushed over the rim"
  deletedAt?: string
  purgedAt?: string // removed for good by the server; only a stub is left there
  updatedAt?: string // stamped on every local change
  dirty?: 1 // changed here since the last sync
}

export interface Glaze {
  id: string
  name: string
  cone?: string // "6", "10", "04"
  color: string // hex for the swatch fallback
  notes?: string
  deletedAt?: string
  updatedAt?: string // stamped on every local change
  dirty?: 1 // changed here since the last sync
}

export interface Clay {
  id: string
  name: string // "Speckled buff", "Porcelain"
  deletedAt?: string
  updatedAt?: string // stamped on every local change
  dirty?: 1 // changed here since the last sync
}

export interface Photo {
  id: string
  // Set only on a row whose bytes haven't moved to photoBytes yet. Nothing
  // writes these any more.
  blob?: Blob
  thumb?: Blob
  hash: string // content hash; dedupes re-imports
  width: number
  height: number
  takenAt: string
  deletedAt?: string // soft delete (tombstone for v2 sync)
  // Where a deleted photo was: the step it was last on. Cleared when it comes back.
  lastPieceId?: string
  lastEntryId?: string
  lastStage?: Stage
  purgedAt?: string // removed for good by the server; only a stub is left there
  updatedAt?: string // stamped on every local change
  mergedInto?: string // id of the photo this duplicate was merged into
  dirty?: 1 // changed here since the last sync
  needsUpload?: 1 // this device has the bytes and the server may not
  needsDownload?: 1 // the details are here but the bytes aren't
}

/**
 * An image's bytes, one entry per hash. Apart from the photo rows, so writing a
 * row never stores its Blobs again. Stays on this device: never tracked and
 * never in a record. Nothing ever deletes from this table.
 */
export interface PhotoBytes {
  hash: string
  blob: Blob // JPEG
  thumb?: Blob // ~400px thumbnail for grids
}

export interface Settings {
  id: 'app'
  defaultClayId?: string
  defaultCone: string
  bisqueNote: string
  firedNote: string
  studioName?: string // shown above My Shelf; "Studio" when unset
  lastBackupAt?: string // ISO time of the last saved backup
  persistRequested?: boolean // unused; kept so old rows and backups still type-check
  updatedAt?: string // stamped on every local change
  dirty?: 1 // changed here since the last sync
}

/** Where this device's record sync stands. One row, id 'state'. */
export interface SyncState {
  id: 'state'
  account: string
  cursor: number
  lastSyncedAt: string
}
