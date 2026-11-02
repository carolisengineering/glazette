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
    this.version(1).stores({
      pieces: 'id, updatedAt, deletedAt',
      entries: 'id, pieceId, [pieceId+date], stage, deletedAt',
      glazeApps: 'id, entryId, pieceId, glazeId',
      glazes: 'id, name, deletedAt',
      clays: 'id, name, deletedAt',
      photos: 'id, hash',
      settings: 'id',
    })
  }
}

export const db = new GlazetteDB()

export const newId = (): string => crypto.randomUUID()
