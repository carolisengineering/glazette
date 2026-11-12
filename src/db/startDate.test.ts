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

test('a dated first step moves the start date earlier', async () => {
  await seed([
    step('e1', 'thrown', { date: '2026-10-02T12:00:00.000Z' }),
    step('e2', 'bisqued', { date: '2026-10-20T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe('2026-10-02T12:00:00.000Z')
  expect((piece?.updatedAt as string) > UPDATED).toBe(true)
})

test('a dated first step moves the start date later', async () => {
  await seed([
    step('e1', 'thrown', { date: '2026-10-09T12:00:00.000Z' }),
    step('e2', 'bisqued', { date: '2026-10-20T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe('2026-10-09T12:00:00.000Z')
  expect((piece?.updatedAt as string) > UPDATED).toBe(true)
})

test('a deleted step is not the first step', async () => {
  await seed([
    step('e1', 'thrown', {
      date: '2026-09-01T12:00:00.000Z',
      deletedAt: '2026-10-07T00:00:00.000Z',
    }),
    step('e2', 'trimmed', { date: '2026-10-08T12:00:00.000Z' }),
    step('e3', 'bisqued', { date: '2026-10-20T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  expect((await db.pieces.get('p1'))?.createdAt).toBe(
    '2026-10-08T12:00:00.000Z',
  )
})

test('an undated first step: a later dated step never moves the start date later', async () => {
  // Created Nov 1 with an undated Thrown step, then Trimmed dated Nov 4.
  const nov1 = '2026-11-01T12:00:00.000Z'
  await seed(
    [
      step('e1', 'thrown'),
      step('e2', 'trimmed', { date: '2026-11-04T12:00:00.000Z' }),
    ],
    { createdAt: nov1 },
  )
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe(nov1)
  expect(piece?.updatedAt).toBe(UPDATED)
})

test('an undated first step: a dated step before the start date moves it earlier', async () => {
  await seed([
    step('e1', 'thrown'),
    step('e2', 'trimmed', { date: '2026-10-03T12:00:00.000Z' }),
    step('e3', 'bisqued', { date: '2026-10-02T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  const piece = await db.pieces.get('p1')
  expect(piece?.createdAt).toBe('2026-10-02T12:00:00.000Z')
  expect((piece?.updatedAt as string) > UPDATED).toBe(true)
})

test('with several steps of the earliest stage, the earliest dated one is the first step', async () => {
  await seed([
    step('e1', 'thrown'),
    step('e2', 'thrown', { date: '2026-10-11T12:00:00.000Z' }),
    step('e3', 'thrown', { date: '2026-10-09T12:00:00.000Z' }),
    step('e4', 'trimmed', { date: '2026-10-07T12:00:00.000Z' }),
  ])
  await followStartDate('p1')
  expect((await db.pieces.get('p1'))?.createdAt).toBe(
    '2026-10-09T12:00:00.000Z',
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
