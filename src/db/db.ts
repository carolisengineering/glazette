import Dexie, { type EntityTable } from 'dexie'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Photo,
  Piece,
  Settings,
  StageEntry,
} from './types'
import { fillSkippedStages } from './upgrade'

class GlazetteDB extends Dexie {
  pieces!: EntityTable<Piece, 'id'>
  entries!: EntityTable<StageEntry, 'id'>
  glazeApps!: EntityTable<GlazeApplication, 'id'>
  glazes!: EntityTable<Glaze, 'id'>
  clays!: EntityTable<Clay, 'id'>
  photos!: EntityTable<Photo, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor() {
    super('glazette')
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
  }
}

export const db = new GlazetteDB()

export const newId = (): string => crypto.randomUUID()
