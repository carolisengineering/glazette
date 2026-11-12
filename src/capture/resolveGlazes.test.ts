import { db } from '../db/db'
import { setStepGlazes } from '../db/stepEdits'
import { loadGlazeRows, resolveGlazes } from './resolveGlazes'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const GONE = '2026-01-01T00:00:00.000Z'

test('loadGlazeRows returns layers in order with names, and one empty row when there are none', async () => {
  await db.glazes.bulkAdd([
    { id: 'gA', name: 'Celadon', color: '#aaaaaa' },
    { id: 'gB', name: 'Old Blue', color: '#0000ff', deletedAt: GONE },
  ])
  await db.glazeApps.bulkAdd([
    {
      id: 'a1',
      entryId: 'e1',
      pieceId: 'p1',
      glazeId: 'gB',
      order: 1,
      method: 'brush',
      note: 'rim',
    },
    {
      id: 'a0',
      entryId: 'e1',
      pieceId: 'p1',
      glazeId: 'gA',
      order: 0,
      dips: 2,
    },
    {
      id: 'a2',
      entryId: 'e1',
      pieceId: 'p1',
      glazeId: 'gA',
      order: 2,
      deletedAt: GONE,
    },
  ])
  const rows = await loadGlazeRows('e1')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ glazeId: 'gA', name: 'Celadon', dips: 2 })
  expect(rows[1]).toMatchObject({
    glazeId: 'gB',
    name: 'Old Blue',
    method: 'brush',
    note: 'rim',
  })
  expect(rows[0].key).not.toBe(rows[1].key)

  const empty = await loadGlazeRows('nope')
  expect(empty).toHaveLength(1)
  expect(empty[0]).toMatchObject({ name: '' })
  expect(empty[0].glazeId).toBeUndefined()
})

test('a layer whose library glaze has not synced yet survives load, resolve and save', async () => {
  const T = '2026-10-01T12:00:00.000Z'
  await db.pieces.add({ id: 'p1', createdAt: T, updatedAt: T })
  await db.entries.add({ id: 'e1', pieceId: 'p1', stage: 'glazed' })
  await db.glazes.add({ id: 'gA', name: 'Celadon', color: '#aaaaaa' })
  await db.glazeApps.bulkAdd([
    { id: 'a0', entryId: 'e1', pieceId: 'p1', glazeId: 'gA', order: 0 },
    {
      id: 'a1',
      entryId: 'e1',
      pieceId: 'p1',
      glazeId: 'gMissing',
      order: 1,
      dips: 3,
    },
    { id: 'a2', entryId: 'e1', pieceId: 'p1', glazeId: 'gA', order: 2 },
  ])
  const before = await db.glazeApps.toArray()
  const rows = await loadGlazeRows('e1')
  expect(rows[1]).toMatchObject({ glazeId: 'gMissing', name: '' })
  const glazes = await resolveGlazes(rows, '6')
  expect(glazes.map((g) => g.glazeId)).toEqual(['gA', 'gMissing', 'gA'])
  expect(await setStepGlazes('e1', glazes)).toBe(false)
  expect(await db.glazeApps.toArray()).toEqual(before)
  // No library glaze is made up for the missing one.
  expect(await db.glazes.count()).toBe(1)
})
