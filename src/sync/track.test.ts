import { CHANGED_AT, EPOCH } from '../../shared/syncProtocol'
import { GlazetteDB } from '../db/db'
import type { StageEntry } from '../db/types'
import { onLocalChange, quietly } from './track'

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
    ['add', (db) => db.entries.add(entry('n1', { updatedAt: EPOCH })), ['n1']],
    [
      'bulkAdd',
      (db) =>
        db.entries.bulkAdd([
          entry('n1', { updatedAt: EPOCH }),
          entry('n2', { updatedAt: EPOCH }),
        ]),
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

test('photos are not tracked', async () => {
  await db.photos.add({
    id: 'ph1',
    blob: new Blob(['a']),
    thumb: new Blob(['b']),
    hash: 'h',
    width: 1,
    height: 1,
    takenAt: '2026-11-08T10:00:00.000Z',
  })
  const row = await db.photos.get('ph1')
  expect(row).toBeDefined()
  expect(row).not.toHaveProperty('dirty')
  expect(row).not.toHaveProperty('updatedAt')
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
