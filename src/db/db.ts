import Dexie, { type EntityTable } from 'dexie'
import { trackChanges } from '../sync/track'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Photo,
  PhotoBytes,
  Piece,
  Settings,
  StageEntry,
  SyncState,
} from './types'
import { dateOldRows, fillSkippedStages, forgetLastSync } from './upgrade'

export class GlazetteDB extends Dexie {
  pieces!: EntityTable<Piece, 'id'>
  entries!: EntityTable<StageEntry, 'id'>
  glazeApps!: EntityTable<GlazeApplication, 'id'>
  glazes!: EntityTable<Glaze, 'id'>
  clays!: EntityTable<Clay, 'id'>
  photos!: EntityTable<Photo, 'id'>
  photoBytes!: EntityTable<PhotoBytes, 'hash'>
  settings!: EntityTable<Settings, 'id'>
  syncState!: EntityTable<SyncState, 'id'>

  constructor(name = 'glazette') {
    super(name)
    const stores = {
      pieces: 'id, updatedAt, deletedAt',
      entries: 'id, pieceId, [pieceId+date], stage, deletedAt',
      glazeApps: 'id, entryId, pieceId, glazeId',
      glazes: 'id, name, deletedAt',
      clays: 'id, name, deletedAt',
      photos: 'id, hash',
      settings: 'id',
    }
    this.version(1).stores(stores)
    // Same stores: version 2 exists only to run the one-time fill.
    this.version(2).stores(stores).upgrade(fillSkippedStages)
    // Indexing dirty finds the rows waiting to sync. The upgrade dates rows
    // changed before sync; a row still without updatedAt counts as unchanged
    // since 1970.
    this.version(3)
      .stores({
        pieces: 'id, updatedAt, deletedAt, dirty',
        entries: 'id, pieceId, [pieceId+date], stage, deletedAt, dirty',
        glazeApps: 'id, entryId, pieceId, glazeId, dirty',
        glazes: 'id, name, deletedAt, dirty',
        clays: 'id, name, deletedAt, dirty',
        settings: 'id, dirty',
        syncState: 'id',
      })
      .upgrade(dateOldRows)
    // Photos sync as records. The upgrade makes every device's first sync
    // after updating a full one. Bytes move to their own table later, row by
    // row, in moveBytesApart: not here, where a long upgrade could abort.
    this.version(4)
      .stores({
        photos: 'id, hash, dirty, needsUpload, needsDownload',
        photoBytes: 'hash',
      })
      .upgrade(forgetLastSync)
    trackChanges(this)
  }
}

export const db = new GlazetteDB()

export const newId = (): string => crypto.randomUUID()

/** What undeleting a photo changes: it's live again and forgets where it was. */
export const UNDELETE_PHOTO: Readonly<Partial<Photo>> = Object.freeze({
  deletedAt: undefined,
  lastPieceId: undefined,
  lastEntryId: undefined,
  lastStage: undefined,
})
