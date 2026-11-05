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
}

export interface Glaze {
  id: string
  name: string
  cone?: string // "6", "10", "04"
  color: string // hex for the swatch fallback
  notes?: string
  deletedAt?: string
}

export interface Clay {
  id: string
  name: string // "Speckled buff", "Porcelain"
  deletedAt?: string
}

export interface Photo {
  id: string
  blob: Blob // stored locally (IndexedDB), JPEG
  thumb: Blob // ~400px thumbnail for grids
  hash: string // content hash; dedupes re-imports
  width: number
  height: number
  takenAt: string
  deletedAt?: string // soft delete (tombstone for v2 sync)
}

export interface Settings {
  id: 'app'
  defaultClayId?: string
  defaultCone: string
  bisqueNote: string
  firedNote: string
}
