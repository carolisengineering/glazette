import { EPOCH, type SyncRecord } from '../../shared/syncProtocol'
import { GlazetteDB } from '../db/db'
import type { Glaze, Piece } from '../db/types'
import {
  applyRecords,
  changedAt,
  clearDirty,
  markAllDirty,
  mergeByName,
  readDirty,
  toRecord,
} from './records'
import { quietly } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`records-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const T3 = '2026-03-01T00:00:00.000Z'

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: T1,
  updatedAt: T1,
  ...extra,
})

const glaze = (
  id: string,
  name: string,
  extra: Partial<Glaze> = {},
): Glaze => ({
  id,
  name,
  color: '#112233',
  updatedAt: T1,
  ...extra,
})

const pieceRecord = (
  id: string,
  changed: string,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'piece',
  id,
  changedAt: changed,
  data: { id, createdAt: T1, updatedAt: changed, ...extra },
})

test('changedAt takes the later of updatedAt and deletedAt, and treats missing or garbled times as 1970', () => {
  expect(changedAt({ updatedAt: T1, deletedAt: T2 })).toBe(T2)
  expect(changedAt({ updatedAt: T3, deletedAt: T2 })).toBe(T3)
  expect(changedAt({ updatedAt: T1 })).toBe(T1)
  expect(changedAt({ deletedAt: T2 })).toBe(T2)
  expect(changedAt({})).toBe(EPOCH)
  expect(changedAt({ updatedAt: 'garbage' })).toBe(EPOCH)
  expect(changedAt({ updatedAt: '2026-01-01' })).toBe(T1)
  expect(changedAt({ updatedAt: 'garbage', deletedAt: T2 })).toBe(T2)
})

test('toRecord leaves out device-only fields', () => {
  const record = toRecord('settings', {
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'b',
    firedNote: 'f',
    updatedAt: T2,
    lastBackupAt: T3,
    persistRequested: true,
    dirty: 1,
  })
  expect(record).toEqual({
    kind: 'settings',
    id: 'app',
    changedAt: T2,
    data: {
      id: 'app',
      defaultCone: '6',
      bisqueNote: 'b',
      firedNote: 'f',
      updatedAt: T2,
    },
  })
})

test('readDirty skips a record too big to send and keeps it waiting', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await db.pieces.add(piece('big', { notes: 'x'.repeat(20_000) }))
  await db.pieces.add(piece('small'))
  const records = await readDirty(db)
  expect(records.map((r) => r.id)).toEqual(['small'])
  expect(warn).toHaveBeenCalled()
  expect((await db.pieces.get('big'))?.dirty).toBe(1)
  warn.mockRestore()
})

test('readDirty returns only dirty rows, from every synced table', async () => {
  await db.pieces.add(piece('p1'))
  await db.clays.add({ id: 'c1', name: 'White' })
  await quietly(db, () => db.clays.put({ id: 'c2', name: 'Red' }))
  const records = await readDirty(db)
  expect(records.map((r) => `${r.kind}:${r.id}`).sort()).toEqual([
    'clay:c1',
    'piece:p1',
  ])
})

test('markAllDirty marks every row without changing its time', async () => {
  await quietly(db, () => db.pieces.add(piece('p1')))
  await markAllDirty(db)
  expect(await db.pieces.get('p1')).toMatchObject({ dirty: 1, updatedAt: T1 })
})

describe('applyRecords follows the later-change rule', () => {
  test('writes a record with no local row', async () => {
    const result = await applyRecords(db, [
      pieceRecord('p1', T2, { name: 'A' }),
    ])
    expect(result).toEqual({ applied: 1, skipped: 0 })
    const row = await db.pieces.get('p1')
    expect(row).toMatchObject({ name: 'A', updatedAt: T2 })
    expect(row?.dirty).toBeUndefined()
  })

  test('writes a record later than the local row', async () => {
    await db.pieces.add(piece('p1', { name: 'mine' }))
    await applyRecords(db, [pieceRecord('p1', T2, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('theirs')
    expect(row?.dirty).toBeUndefined()
  })

  test('on a tie, the record wins over a dirty local row and clears dirty', async () => {
    await db.pieces.add(piece('p1', { name: 'mine' }))
    await applyRecords(db, [pieceRecord('p1', T1, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('theirs')
    expect(row?.dirty).toBeUndefined()
  })

  test('on a tie, a clean local row stays', async () => {
    await quietly(db, () => db.pieces.add(piece('p1', { name: 'mine' })))
    await applyRecords(db, [pieceRecord('p1', T1, { name: 'theirs' })])
    expect((await db.pieces.get('p1'))?.name).toBe('mine')
  })

  test('keeps a local row that is later', async () => {
    await db.pieces.add(piece('p1', { name: 'mine', updatedAt: T3 }))
    await applyRecords(db, [pieceRecord('p1', T2, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('mine')
    expect(row?.dirty).toBe(1)
  })

  test('a later tombstone deletes a local row', async () => {
    await quietly(db, () => db.pieces.add(piece('p1')))
    await applyRecords(db, [
      {
        kind: 'piece',
        id: 'p1',
        changedAt: T2,
        data: { id: 'p1', createdAt: T1, updatedAt: T1, deletedAt: T2 },
      },
    ])
    expect((await db.pieces.get('p1'))?.deletedAt).toBe(T2)
  })
})

test("applyRecords skips what it can't use and applies the rest", async () => {
  const result = await applyRecords(db, [
    { kind: 'sticker', id: 'x1', changedAt: T1, data: { id: 'x1' } },
    {
      kind: 'entry',
      id: 'e1',
      changedAt: T1,
      data: { id: 'e1', pieceId: 'p1', stage: 'kilned' },
    },
    {
      kind: 'piece',
      id: 'p2',
      changedAt: T1,
      data: { id: 'p2', updatedAt: T1 },
    },
    {
      kind: 'glaze',
      id: 'g1',
      changedAt: T1,
      data: { id: 'g1', name: 'Shino', color: '#aabbcc' },
    },
  ])
  expect(result).toEqual({ applied: 1, skipped: 3 })
  expect(await db.glazes.toArray()).toHaveLength(1)
  expect(await db.entries.count()).toBe(0)
  expect(await db.pieces.count()).toBe(0)
})

test("applyRecords keeps this device's lastBackupAt", async () => {
  await db.settings.add({
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'b',
    firedNote: 'f',
    lastBackupAt: T3,
    persistRequested: true,
    updatedAt: T1,
  })
  await applyRecords(db, [
    {
      kind: 'settings',
      id: 'app',
      changedAt: T2,
      data: {
        id: 'app',
        defaultCone: '04',
        bisqueNote: 'b',
        firedNote: 'f',
        updatedAt: T2,
      },
    },
  ])
  const row = await db.settings.get('app')
  expect(row).toMatchObject({
    defaultCone: '04',
    lastBackupAt: T3,
    persistRequested: true,
  })
  expect(row?.dirty).toBeUndefined()
})

test("applyRecords keeps a field it doesn't know", async () => {
  await applyRecords(db, [pieceRecord('p1', T2, { extra: 1 })])
  expect(await db.pieces.get('p1')).toMatchObject({ extra: 1 })
})

test('applyRecords never writes dirty from a record', async () => {
  await applyRecords(db, [pieceRecord('p1', T2, { dirty: 1 })])
  expect((await db.pieces.get('p1'))?.dirty).toBeUndefined()
})

test('applyRecords fixes a glaze color it cannot show', async () => {
  await applyRecords(db, [
    {
      kind: 'glaze',
      id: 'g1',
      changedAt: T1,
      data: { id: 'g1', name: 'Shino', color: 'blue' },
    },
  ])
  expect((await db.glazes.get('g1'))?.color).toMatch(/^#[0-9a-f]{6}$/i)
})

test('clearDirty keeps a row that changed after it was read dirty', async () => {
  await db.pieces.add(piece('p1'))
  await db.pieces.add(piece('p2'))
  const records = await readDirty(db)
  await db.pieces.update('p2', { name: 'edited', updatedAt: T3 })
  await clearDirty(db, records)
  expect((await db.pieces.get('p1'))?.dirty).toBeUndefined()
  expect((await db.pieces.get('p2'))?.dirty).toBe(1)
})

describe('mergeByName', () => {
  // The account's rows are already stored here (a pull wrote them) when the
  // merge runs; accountIds says which rows came from the account.
  test('joins same-named glazes and clays', async () => {
    await quietly(db, async () => {
      await db.clays.bulkAdd([
        { id: 'lc', name: 'White stoneware', updatedAt: T1 },
        { id: 'ac', name: 'White stoneware', updatedAt: T2 },
        { id: 'lc2', name: 'Red', updatedAt: T1 },
      ])
      await db.glazes.bulkAdd([
        glaze('lg', ' shino'),
        glaze('ag', 'Shino', { updatedAt: T2 }),
        glaze('lg2', 'Celadon'),
      ])
      await db.pieces.bulkAdd([
        piece('p1', { clayId: 'lc' }),
        piece('p2', { clayId: 'lc2' }),
      ])
      await db.glazeApps.bulkAdd([
        {
          id: 'a1',
          entryId: 'e1',
          pieceId: 'p1',
          glazeId: 'lg',
          order: 0,
          updatedAt: T1,
        },
        {
          id: 'a2',
          entryId: 'e1',
          pieceId: 'p1',
          glazeId: 'lg2',
          order: 1,
          updatedAt: T1,
        },
      ])
      await db.settings.add({
        id: 'app',
        defaultCone: '6',
        bisqueNote: 'b',
        firedNote: 'f',
        defaultClayId: 'lc',
        updatedAt: T1,
      })
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set(['ac']) })

    expect(await db.pieces.get('p1')).toMatchObject({
      clayId: 'ac',
      updatedAt: T1,
      dirty: 1,
    })
    expect((await db.pieces.get('p2'))?.clayId).toBe('lc2')
    expect(await db.glazeApps.get('a1')).toMatchObject({
      glazeId: 'ag',
      dirty: 1,
    })
    expect((await db.glazeApps.get('a2'))?.glazeId).toBe('lg2')
    expect(await db.settings.get('app')).toMatchObject({
      defaultClayId: 'ac',
      dirty: 1,
    })
    for (const [table, id] of [
      [db.clays, 'lc'],
      [db.glazes, 'lg'],
    ] as const) {
      const row = await table.get(id)
      expect(row?.deletedAt).toBeTruthy()
      expect(row?.dirty).toBe(1)
    }
    expect((await db.clays.get('ac'))?.deletedAt).toBeUndefined()
    expect((await db.glazes.get('lg2'))?.deletedAt).toBeUndefined()
  })

  test('leaves a deleted account row alone', async () => {
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino'),
        glaze('ag', 'Shino', { updatedAt: T2, deletedAt: T2 }),
      ])
    })
    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })
    expect((await db.glazes.get('lg'))?.deletedAt).toBeUndefined()
  })
})
