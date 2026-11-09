import { CHANGED_AT, EPOCH } from '../../shared/syncProtocol'
import { GlazetteDB } from '../db/db'
import type { Photo, StageEntry } from '../db/types'
import { readDirty } from './records'
import { onLocalChange, quietly, SYNCED_TABLES } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`track-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const entry = (id: string, extra: Partial<StageEntry> = {}): StageEntry => ({
  id,
  pieceId: 'p1',
  stage: 'thrown',
  ...extra,
})

test('a new row in a synced table is dirty and stamped', async () => {
  await db.entries.add(entry('e1'))
  await db.glazeApps.add({
    id: 'a1',
    entryId: 'e1',
    pieceId: 'p1',
    glazeId: 'g1',
    order: 0,
  })
  await db.glazes.add({ id: 'g1', name: 'Celadon', color: '#9DBBAA' })
  await db.clays.add({ id: 'c1', name: 'Porcelain' })
  await db.settings.add({
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'Cone 6',
    firedNote: 'Cone 6 oxidation',
  })
  const rows = [
    await db.entries.get('e1'),
    await db.glazeApps.get('a1'),
    await db.glazes.get('g1'),
    await db.clays.get('c1'),
    await db.settings.get('app'),
  ]
  for (const row of rows) {
    expect(row?.dirty).toBe(1)
    expect(row?.updatedAt).toMatch(CHANGED_AT)
    expect(row?.updatedAt).not.toBe(EPOCH)
  }
})

test('pieces keep the updatedAt the app gives them', async () => {
  const X = '2026-01-02T03:04:05.006Z'
  await db.pieces.add({ id: 'p1', createdAt: X, updatedAt: X })
  expect(await db.pieces.get('p1')).toMatchObject({ updatedAt: X, dirty: 1 })
  await quietly(db, () => db.pieces.update('p1', { dirty: undefined }))
  await db.pieces.update('p1', { name: 'n' })
  expect(await db.pieces.get('p1')).toMatchObject({
    name: 'n',
    updatedAt: X,
    dirty: 1,
  })
})

describe('every write method marks the row', () => {
  beforeEach(async () => {
    await quietly(db, () =>
      db.entries.bulkAdd([
        entry('s1', { updatedAt: EPOCH }),
        entry('s2', { updatedAt: EPOCH }),
        entry('s3', { pieceId: 'p2', updatedAt: EPOCH }),
        entry('s4', { pieceId: 'p2', updatedAt: EPOCH }),
        entry('other', { pieceId: 'p3', updatedAt: EPOCH }),
      ]),
    )
  })

  test.each<[string, (db: GlazetteDB) => Promise<unknown>, string[]]>([
    // New rows come without updatedAt; a given one is kept (tested below).
    ['add', (db) => db.entries.add(entry('n1')), ['n1']],
    [
      'bulkAdd',
      (db) => db.entries.bulkAdd([entry('n1'), entry('n2')]),
      ['n1', 'n2'],
    ],
    [
      'put',
      (db) => db.entries.put(entry('s1', { note: 'x', updatedAt: EPOCH })),
      ['s1'],
    ],
    [
      'bulkPut',
      (db) =>
        db.entries.bulkPut([
          entry('s1', { note: 'x', updatedAt: EPOCH }),
          entry('s2', { note: 'y', updatedAt: EPOCH }),
        ]),
      ['s1', 's2'],
    ],
    ['update', (db) => db.entries.update('s1', { note: 'x' }), ['s1']],
    [
      'bulkUpdate',
      (db) =>
        db.entries.bulkUpdate([
          { key: 's1', changes: { note: 'x' } },
          { key: 's2', changes: { note: 'y' } },
        ]),
      ['s1', 's2'],
    ],
    [
      'where(...).modify(...)',
      (db) => db.entries.where('pieceId').equals('p2').modify({ note: 'x' }),
      ['s3', 's4'],
    ],
  ])('%s', async (_name, write, touched) => {
    await write(db)
    for (const id of touched) {
      const row = await db.entries.get(id)
      expect(row?.dirty).toBe(1)
      expect(row?.updatedAt).toMatch(CHANGED_AT)
      expect(row?.updatedAt).not.toBe(EPOCH)
    }
    const other = await db.entries.get('other')
    expect(other?.dirty).toBeUndefined()
    expect(other?.updatedAt).toBe(EPOCH)
  })
})

test('a given updatedAt is kept on create', async () => {
  const T = '2026-10-01T09:00:00.000Z'
  await db.entries.add(entry('k1', { updatedAt: T }))
  await db.entries.bulkPut([entry('k2', { updatedAt: EPOCH })])
  expect(await db.entries.get('k1')).toMatchObject({ updatedAt: T, dirty: 1 })
  expect(await db.entries.get('k2')).toMatchObject({
    updatedAt: EPOCH,
    dirty: 1,
  })
})

test('an update that sets updatedAt keeps it', async () => {
  await quietly(db, () => db.entries.add(entry('u1', { updatedAt: EPOCH })))
  const T = '2026-10-01T09:00:00.000Z'
  await db.entries.update('u1', { note: 'x', updatedAt: T })
  expect(await db.entries.get('u1')).toMatchObject({ updatedAt: T, dirty: 1 })
  // A put whose row carries a new updatedAt keeps it too.
  const U = '2026-10-02T09:00:00.000Z'
  await db.entries.put(entry('u1', { note: 'y', updatedAt: U }))
  expect(await db.entries.get('u1')).toMatchObject({ updatedAt: U, dirty: 1 })
})

test("local-only settings fields don't count as a change", async () => {
  await quietly(db, () =>
    db.settings.add({
      id: 'app',
      defaultCone: '6',
      bisqueNote: 'Cone 6',
      firedNote: 'Cone 6 oxidation',
      updatedAt: EPOCH,
    }),
  )
  const T = '2026-11-08T10:00:00.000Z'
  await db.settings.update('app', { lastBackupAt: T })
  await db.settings.update('app', { persistRequested: true })
  let row = await db.settings.get('app')
  expect(row?.lastBackupAt).toBe(T)
  expect(row?.dirty).toBeUndefined()
  expect(row?.updatedAt).toBe(EPOCH)

  await db.settings.update('app', { studioName: 'Penguin Foot' })
  row = await db.settings.get('app')
  expect(row?.dirty).toBe(1)
  expect(row?.updatedAt).not.toBe(EPOCH)
})

test('quiet writes leave rows as written', async () => {
  const row = entry('q1', { note: 'as written' })
  await quietly(db, () => db.entries.put(row))
  expect(await db.entries.get('q1')).toEqual(row)

  // A nested transaction inside quietly is quiet too.
  await quietly(db, () =>
    db.transaction('rw', db.entries, () =>
      db.entries.update('q1', { note: 'nested' }),
    ),
  )
  expect(await db.entries.get('q1')).toEqual({ ...row, note: 'nested' })

  await db.entries.update('q1', { note: 'changed' })
  expect((await db.entries.get('q1'))?.dirty).toBe(1)
  const stamped = (await db.entries.get('q1'))?.updatedAt
  await quietly(db, () => db.entries.update('q1', { dirty: undefined }))
  const after = await db.entries.get('q1')
  expect(after?.dirty).toBeUndefined()
  expect(after?.updatedAt).toBe(stamped)
})

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: 'a'.repeat(64),
  width: 1,
  height: 1,
  takenAt: '2026-11-08T10:00:00.000Z',
  ...extra,
})

test('a new photo row is dirty and stamped, and waits to upload only if told', async () => {
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)
  await db.photos.add(photo('ph1'))
  await db.photos.add(photo('ph2', { needsUpload: 1 }))
  stop()
  const row = await db.photos.get('ph1')
  expect(row?.dirty).toBe(1)
  expect(row?.needsUpload).toBeUndefined()
  expect(row?.updatedAt).toMatch(CHANGED_AT)
  expect((await db.photos.get('ph2'))?.needsUpload).toBe(1)
  expect(listener).toHaveBeenCalledTimes(2)
})

test('a row holding bytes is not marked waiting just for holding them', async () => {
  await db.photos.add(photo('ph1', { blob: new Blob(['a']) }))
  expect((await db.photos.get('ph1'))?.needsUpload).toBeUndefined()
  await quietly(db, () => db.photos.add(photo('ph2')))
  await db.photos.update('ph2', { blob: new Blob(['a']) })
  expect((await db.photos.get('ph2'))?.needsUpload).toBeUndefined()
})

test('a photo starting to wait for upload tells the listeners, without being a change to sync', async () => {
  const T = '2026-01-01T00:00:00.000Z'
  await quietly(db, () => db.photos.add(photo('ph1', { updatedAt: T })))
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)

  await db.photos.update('ph1', { needsUpload: 1 })
  expect(listener).toHaveBeenCalledTimes(1)
  const row = await db.photos.get('ph1')
  expect(row?.dirty).toBeUndefined()
  expect(row?.updatedAt).toBe(T)

  // It stops waiting, or the write is quiet: nothing to start.
  await db.photos.update('ph1', { needsUpload: undefined })
  await quietly(db, () => db.photos.update('ph1', { needsUpload: 1 }))
  await db.photos.update('ph1', { needsDownload: 1 })
  stop()
  expect(listener).toHaveBeenCalledTimes(1)
})

test('the bytes table never marks anything to sync', async () => {
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)
  const entry = { hash: 'a'.repeat(64), blob: new Blob(['a']) }
  await db.photoBytes.add(entry)
  await db.photoBytes.update(entry.hash, { thumb: new Blob(['b']) })
  await db.photoBytes.put(entry)
  stop()
  expect(listener).not.toHaveBeenCalled()
  const row = await db.photoBytes.get(entry.hash)
  expect(row).not.toHaveProperty('dirty')
  expect(row).not.toHaveProperty('updatedAt')
  expect(SYNCED_TABLES).not.toContain('photoBytes')
  // Nothing in it is ever read as a record.
  expect(await readDirty(db)).toEqual([])
})

test('quietly covers the bytes table', async () => {
  const entry = { hash: 'a'.repeat(64), blob: new Blob(['a']) }
  await quietly(db, () => db.photoBytes.add(entry))
  expect(await db.photoBytes.count()).toBe(1)
})

test("device-only photo fields don't count as a change", async () => {
  const T = '2026-01-01T00:00:00.000Z'
  await quietly(db, () => db.photos.add(photo('ph1', { updatedAt: T })))
  for (const changes of [
    { needsUpload: 1 as const },
    { needsDownload: 1 as const },
    { thumb: new Blob(['t']) },
    { blob: new Blob(['x']) },
  ]) {
    await db.photos.update('ph1', changes)
    const row = await db.photos.get('ph1')
    expect(row?.dirty).toBeUndefined()
    expect(row?.updatedAt).toBe(T)
  }
})

test('listeners hear about committed local changes only', async () => {
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)

  await db.transaction('rw', db.entries, db.clays, async () => {
    await db.entries.add(entry('l1'))
    await db.clays.add({ id: 'c1', name: 'Porcelain' })
    // A nested transaction joins the outer one.
    await db.transaction('rw', db.entries, () => db.entries.add(entry('l2')))
    expect(listener).not.toHaveBeenCalled()
  })
  expect(listener).toHaveBeenCalledTimes(1)

  await quietly(db, () => db.entries.add(entry('l3')))
  expect(listener).toHaveBeenCalledTimes(1)

  await expect(
    db.transaction('rw', db.entries, async () => {
      await db.entries.add(entry('l4'))
      throw new Error('roll back')
    }),
  ).rejects.toThrow('roll back')
  expect(await db.entries.get('l4')).toBeUndefined()
  expect(listener).toHaveBeenCalledTimes(1)

  await db.entries.update('l1', { note: 'one more' })
  expect(listener).toHaveBeenCalledTimes(2)

  stop()
  await db.entries.update('l1', { note: 'after stop' })
  expect(listener).toHaveBeenCalledTimes(2)
})
