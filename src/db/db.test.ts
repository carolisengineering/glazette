import Dexie from 'dexie'
import { db, GlazetteDB } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const SYNCED = ['pieces', 'entries', 'glazeApps', 'glazes', 'clays', 'settings']

test('schema has the nine tables and compound index entries.[pieceId+date]', () => {
  expect(db.tables.map((t) => t.name).sort()).toEqual(
    [...SYNCED, 'photos', 'photoBytes', 'syncState'].sort(),
  )
  const indexes = db.table('entries').schema.indexes.map((i) => i.name)
  expect(indexes).toContain('[pieceId+date]')
})

test('version 4 indexes dirty on the six synced tables and the photo flags', () => {
  expect(db.verno).toBe(4)
  for (const name of SYNCED) {
    const indexes = db.table(name).schema.indexes.map((i) => i.name)
    expect(indexes, name).toContain('dirty')
  }
  const photoIndexes = db.table('photos').schema.indexes.map((i) => i.name)
  expect(photoIndexes.sort()).toEqual(
    ['hash', 'dirty', 'needsUpload', 'needsDownload'].sort(),
  )
  expect(db.table('syncState').schema.primKey.name).toBe('id')
})

test('the photoBytes table exists at version 4, keyed by hash', () => {
  expect(db.verno).toBe(4)
  expect(db.table('photoBytes').schema.primKey.name).toBe('hash')
  expect(db.table('photoBytes').schema.indexes).toEqual([])
})

test('the upgrade to version 4 leaves bytes on their rows', async () => {
  const name = `upgrade4-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(3).stores({
    pieces: 'id, updatedAt, deletedAt, dirty',
    entries: 'id, pieceId, [pieceId+date], stage, deletedAt, dirty',
    glazeApps: 'id, entryId, pieceId, glazeId, dirty',
    glazes: 'id, name, deletedAt, dirty',
    clays: 'id, name, deletedAt, dirty',
    photos: 'id, hash',
    settings: 'id, dirty',
    syncState: 'id',
  })
  await old.open()
  await old.table('photos').add({ id: 'ph1', hash: 'h', blob: new Blob(['b']) })
  old.close()
  const upgraded = new GlazetteDB(name)
  try {
    await upgraded.open()
    expect((await upgraded.photos.get('ph1'))?.blob).toBeDefined()
    expect(await upgraded.photoBytes.count()).toBe(0)
  } finally {
    await upgraded.delete()
  }
})

test('opening version 4 forgets the last sync', async () => {
  const name = `upgrade4-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(3).stores({
    pieces: 'id, updatedAt, deletedAt, dirty',
    entries: 'id, pieceId, [pieceId+date], stage, deletedAt, dirty',
    glazeApps: 'id, entryId, pieceId, glazeId, dirty',
    glazes: 'id, name, deletedAt, dirty',
    clays: 'id, name, deletedAt, dirty',
    photos: 'id, hash',
    settings: 'id, dirty',
    syncState: 'id',
  })
  await old.open()
  await old.table('syncState').add({
    id: 'state',
    account: 'me',
    cursor: 5,
    lastSyncedAt: '2026-11-08T10:00:00.000Z',
  })
  old.close()
  const upgraded = new GlazetteDB(name)
  try {
    await upgraded.open()
    expect(await upgraded.syncState.count()).toBe(0)
  } finally {
    await upgraded.delete()
  }
})

describe('the version 3 upgrade', () => {
  const T = '2026-06-01T12:00:00.000Z'
  const V2_STORES = {
    pieces: 'id, updatedAt, deletedAt',
    entries: 'id, pieceId, [pieceId+date], stage, deletedAt',
    glazeApps: 'id, entryId, pieceId, glazeId',
    glazes: 'id, name, deletedAt',
    clays: 'id, name, deletedAt',
    photos: 'id, hash',
    settings: 'id',
  }
  // The settings ensureDefaults writes.
  const DEFAULTS = {
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'Cone 6',
    firedNote: 'Cone 6 oxidation',
    defaultClayId: 'c1',
  }

  let name: string
  let upgraded: GlazetteDB | undefined

  beforeEach(() => {
    name = `upgrade-${crypto.randomUUID()}`
    upgraded = undefined
  })

  afterEach(async () => {
    if (upgraded) await upgraded.delete()
  })

  /** Seeds a version 2 database, then opens it as the app does. */
  async function upgradeFrom(seed: (old: Dexie) => Promise<void>) {
    const old = new Dexie(name)
    old.version(2).stores(V2_STORES)
    await old.open()
    await seed(old)
    old.close()
    upgraded = new GlazetteDB(name)
    await upgraded.open()
    return upgraded
  }

  test('the version 3 upgrade dates old steps, layers and edited settings', async () => {
    const started = new Date().toISOString()
    const db3 = await upgradeFrom(async (old) => {
      await old.table('pieces').add({ id: 'p1', createdAt: T, updatedAt: T })
      await old.table('entries').bulkAdd([
        { id: 'e1', pieceId: 'p1', stage: 'glazed', note: 'Shino' },
        { id: 'e2', pieceId: 'gone', stage: 'thrown' },
      ])
      await old.table('glazeApps').add({
        id: 'l1',
        entryId: 'e1',
        pieceId: 'p1',
        glazeId: 'g1',
        order: 0,
      })
      await old.table('settings').add({
        ...DEFAULTS,
        studioName: 'Penguin Foot',
        bisqueNote: 'Cone 04',
      })
      await old
        .table('glazes')
        .add({ id: 'g1', name: 'Shino', color: '#aa8866' })
    })

    expect((await db3.entries.get('e1'))?.updatedAt).toBe(T)
    expect((await db3.glazeApps.get('l1'))?.updatedAt).toBe(T)
    expect((await db3.entries.get('e2'))?.updatedAt).toBeUndefined()
    const settings = await db3.settings.get('app')
    expect(settings).toMatchObject({
      studioName: 'Penguin Foot',
      bisqueNote: 'Cone 04',
    })
    expect(settings?.updatedAt).toBeDefined()
    expect((settings?.updatedAt ?? '') >= started).toBe(true)
    expect((await db3.glazes.get('g1'))?.updatedAt).toBeUndefined()
  })

  test('untouched default settings stay undated after the upgrade', async () => {
    const db3 = await upgradeFrom(async (old) => {
      // Device-only fields don't count as an edit.
      await old.table('settings').add({
        ...DEFAULTS,
        lastBackupAt: '2026-05-01T00:00:00.000Z',
        persistRequested: true,
      })
    })
    expect((await db3.settings.get('app'))?.updatedAt).toBeUndefined()
  })
})
