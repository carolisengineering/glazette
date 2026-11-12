import { db } from './db'
import { followStartDate } from './startDate'
import type { Piece, StageEntry } from './types'

const T0 = '2026-10-05T12:00:00.000Z'
const UPDATED = '2026-10-06T00:00:00.000Z'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const step = (
  id: string,
  stage: StageEntry['stage'],
  extra: Partial<StageEntry> = {},
): StageEntry => ({ id, pieceId: 'p1', stage, ...extra })

async function seed(entries: StageEntry[], extra: Partial<Piece> = {}) {
  await db.pieces.add({
    id: 'p1',
    createdAt: T0,
    updatedAt: UPDATED,
    ...extra,
  })
  await db.entries.bulkAdd(entries)
}

test('follows the earliest dated live step', async () => {
  await seed([
    step('e1', 'thrown', { date: '2026-10-02T12:00:00.000Z' }),
    step('e2', 'bisqued', { date: '2026-10-20T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe('2026-10-02T12:00:00.000Z')
  expect((piece?.updatedAt as string) > UPDATED).toBe(true)
})

test('ignores deleted and undated steps', async () => {
  await seed([
    step('e1', 'thrown', {
      date: '2026-09-01T12:00:00.000Z',
      deletedAt: '2026-10-07T00:00:00.000Z',
    }),
    step('e2', 'trimmed'),
    step('e3', 'bisqued', { date: '2026-10-20T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  expect((await db.pieces.get('p1'))?.createdAt).toBe(
    '2026-10-20T12:00:00.000Z',
  )
})

test('leaves createdAt alone when no step has a date', async () => {
  await seed([step('e1', 'thrown')])
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe(T0)
  expect(piece?.updatedAt).toBe(UPDATED)
})

test('does not touch the piece when the date already matches', async () => {
  await seed([step('e1', 'thrown', { date: T0 })])
  await followStartDate('p1')
  expect((await db.pieces.get('p1'))?.updatedAt).toBe(UPDATED)
})
