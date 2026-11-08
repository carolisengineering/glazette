import Dexie from 'dexie'
import { db } from './db'
import type { Piece, StageEntry } from './types'

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  ...extra,
})

async function seedV1(pieces: Piece[], entries: StageEntry[]) {
  await db.delete()
  const old = new Dexie('glazette')
  old.version(1).stores({
    pieces: 'id, updatedAt, deletedAt',
    entries: 'id, pieceId, [pieceId+date], stage, deletedAt',
    glazeApps: 'id, entryId, pieceId, glazeId',
    glazes: 'id, name, deletedAt',
    clays: 'id, name, deletedAt',
    photos: 'id, hash',
    settings: 'id',
  })
  await old.open()
  await old.table('pieces').bulkAdd(pieces)
  await old.table('entries').bulkAdd(entries)
  old.close()
  // Opening the app's db at version 2 runs the upgrade.
  await db.open()
}

const e = (
  id: string,
  pieceId: string,
  stage: StageEntry['stage'],
  extra: Partial<StageEntry> = {},
): StageEntry => ({
  id,
  pieceId,
  stage,
  date: '2026-01-02T12:00:00.000Z',
  photoId: `ph-${id}`,
  ...extra,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(async () => {
  await db.delete()
  await db.open()
})

test('upgrade fills Trimmed for a piece that went Thrown → Bisqued', async () => {
  const original = [e('a', 'p1', 'thrown'), e('b', 'p1', 'bisqued')]
  await seedV1([piece('p1')], original)
  const rows = await db.entries.where('pieceId').equals('p1').toArray()
  expect(rows).toHaveLength(3)
  const added = rows.find((r) => r.stage === 'trimmed')
  expect(added).toBeDefined()
  // dirty and updatedAt are sync marks (see src/sync/track.ts), not step data.
  const { dirty, updatedAt, ...step } = added as StageEntry
  expect(dirty).toBe(1)
  expect(updatedAt).toBeDefined()
  expect(Object.keys(step).sort()).toEqual(['id', 'pieceId', 'stage'])
  for (const o of original) expect(rows).toContainEqual(o)
})

test('upgrade leaves a stage whose step was deleted alone', async () => {
  const original = [
    e('a', 'p1', 'thrown'),
    e('t', 'p1', 'trimmed', { deletedAt: '2026-01-03T12:00:00.000Z' }),
    e('b', 'p1', 'bisqued'),
  ]
  await seedV1([piece('p1')], original)
  const rows = await db.entries.toArray()
  expect(rows).toHaveLength(3)
  for (const o of original) expect(rows).toContainEqual(o)
})

test('upgrade skips deleted pieces and pieces with no gaps', async () => {
  const original = [
    e('a', 'p1', 'thrown'),
    e('b', 'p1', 'trimmed'),
    e('c', 'p2', 'thrown'),
    e('d', 'p2', 'bisqued'),
  ]
  await seedV1(
    [piece('p1'), piece('p2', { deletedAt: '2026-01-04T12:00:00.000Z' })],
    original,
  )
  const rows = await db.entries.toArray()
  expect(rows).toHaveLength(4)
  for (const o of original) expect(rows).toContainEqual(o)
})
