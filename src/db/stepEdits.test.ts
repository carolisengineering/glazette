import { db } from './db'
import { setStepGlazes } from './stepEdits'
import type { GlazeApplication, Piece, StageEntry } from './types'

const T1 = '2026-01-01T00:00:00.000Z'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seed(stage: StageEntry['stage'], glazeIds: string[]) {
  const piece: Piece = { id: 'p1', createdAt: T1, updatedAt: T1 }
  await db.pieces.add(piece)
  await db.entries.add({ id: 'e1', pieceId: 'p1', stage })
  await db.glazeApps.bulkAdd(
    glazeIds.map((glazeId, i) => ({
      id: `a${i}`,
      entryId: 'e1',
      pieceId: 'p1',
      glazeId,
      order: i,
    })),
  )
}

const live = async (): Promise<GlazeApplication[]> =>
  (await db.glazeApps.where('entryId').equals('e1').toArray())
    .filter((a) => !a.deletedAt)
    .sort((a, b) => a.order - b.order)

test('adds glazes to a Glazed step logged without any', async () => {
  await seed('glazed', [])
  expect(await setStepGlazes('e1', [{ glazeId: 'A' }, { glazeId: 'B' }])).toBe(
    true,
  )
  const apps = await live()
  expect(apps.map((a) => [a.glazeId, a.order])).toEqual([
    ['A', 0],
    ['B', 1],
  ])
})

test('reorders by updating rows in place', async () => {
  await seed('glazed', ['A', 'B'])
  await setStepGlazes('e1', [{ glazeId: 'B' }, { glazeId: 'A' }])
  const apps = await live()
  expect(apps.map((a) => a.id).sort()).toEqual(['a0', 'a1'])
  expect(apps.map((a) => a.glazeId)).toEqual(['B', 'A'])
  expect(await db.glazeApps.count()).toBe(2)
})

test('removing a glaze soft-deletes the extra row', async () => {
  await seed('glazed', ['A', 'B'])
  await setStepGlazes('e1', [{ glazeId: 'A' }])
  expect(await live()).toHaveLength(1)
  expect((await db.glazeApps.get('a1'))?.deletedAt).toBeTruthy()
})

test('an empty list clears every glaze', async () => {
  await seed('glazed', ['A', 'B'])
  expect(await setStepGlazes('e1', [])).toBe(true)
  expect(await live()).toHaveLength(0)
})

test('saving the same glazes changes nothing and returns false', async () => {
  await seed('glazed', ['A', 'B'])
  const before = await db.glazeApps.toArray()
  const piece = await db.pieces.get('p1')
  expect(await setStepGlazes('e1', [{ glazeId: 'A' }, { glazeId: 'B' }])).toBe(
    false,
  )
  expect(await db.glazeApps.toArray()).toEqual(before)
  expect((await db.pieces.get('p1'))?.updatedAt).toBe(piece?.updatedAt)
})

test('throws for a step that is not Glazed', async () => {
  await seed('bisqued', [])
  await expect(setStepGlazes('e1', [{ glazeId: 'A' }])).rejects.toThrow(
    'Step not found',
  )
})
