import type {
  Clay,
  Glaze,
  GlazeApplication,
  Photo,
  Piece,
  Settings,
  StageEntry,
} from '../db/types'

export const BACKUP_VERSION = 1

export const BACKUP_JSON_PATH = 'glazette.json'

// Photo rows without the binary parts. The bytes live beside the JSON, by hash.
export type PhotoMeta = Omit<Photo, 'blob' | 'thumb'>

export interface BackupJson {
  version: 1
  /** Dexie schema version of the exporting app. Older backups lack it. */
  dbVersion?: number
  exportedAt: string
  pieces: Piece[]
  entries: StageEntry[]
  glazeApps: GlazeApplication[]
  glazes: Glaze[]
  clays: Clay[]
  settings: Settings | null
  photos: PhotoMeta[]
}

export const photoPath = (hash: string) => `photos/${hash}.jpg`
export const thumbPath = (hash: string) => `thumbs/${hash}.jpg`
