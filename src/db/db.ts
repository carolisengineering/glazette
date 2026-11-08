import Dexie, { type EntityTable } from 'dexie'
import { trackChanges } from '../sync/track'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Photo,
  Piece,
  Settings,
  StageEntry,
  SyncState,
} from './types'
import { fillSkippedStages } from './upgrade'

export class GlazetteDB extends Dexie {
  pieces!: EntityTable<Piece, 'id'>
  entries!: EntityTable<StageEntry, 'id'>
  glazeApps!: EntityTable<GlazeApplication, 'id'>
  glazes!: EntityTable<Glaze, 'id'>
  clays!: EntityTable<Clay, 'id'>
  photos!: EntityTable<Photo, 'id'>
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
    // Indexing dirty finds the rows waiting to sync. No upgrade: a row without
    // updatedAt counts as unchanged since 1970.
    this.version(3).stores({
      pieces: 'id, updatedAt, deletedAt, dirty',
      entries: 'id, pieceId, [pieceId+date], stage, deletedAt, dirty',
      glazeApps: 'id, entryId, pieceId, glazeId, dirty',
      glazes: 'id, name, deletedAt, dirty',
      clays: 'id, name, deletedAt, dirty',
      settings: 'id, dirty',
      syncState: 'id',
    })
    trackChanges(this)
  }
}

export const db = new GlazetteDB()

export const newId = (): string => crypto.randomUUID()
