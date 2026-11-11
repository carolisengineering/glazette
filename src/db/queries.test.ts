import { db } from './db'
import { addStageEntry, createPiece, ensureDefaults, softDelete } from './ops'
import {
  buildPieceViews,
  chipCounts,
  filterShelf,
  notDeleted,
  type PieceView,
} from './queries'
import type { Piece, Stage, StageEntry } from './types'

const NOW = new Date('2026-11-20T12:00:00.000Z')
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

function view(
  id: string,
  stages: Array<[Stage, string]>,
  over: Partial<Piece> = {},
): PieceView {
  const entries: StageEntry[] = stages.map(([stage, date], i) => ({
    id: `${id}-${i}`,
    pieceId: id,
    stage,
    date,
  }))
  const last = stages[stages.length - 1]?.[0]
  return {
    piece: { id, createdAt: daysAgo(30), updatedAt: daysAgo(30), ...over },
    entries,
    stage: last,
    glazeNames: [],
    glazeLayers: [],
  }
}

const fired13 = view('f13', [['fired', daysAgo(13)]])
const fired15 = view('f15', [['fired', daysAgo(15)]])
const trimmed = view('t', [['trimmed', daysAgo(1)]])
const lost = view('l', [['thrown', daysAgo(2)]], { lost: true })
const all = [fired13, fired15, trimmed, lost]
const ids = (vs: PieceView[]) => vs.map((v) => v.piece.id)

test('notDeleted keeps rows without deletedAt', () => {
  expect(notDeleted({})).toBe(true)
  expect(notDeleted({ deletedAt: '2026-11-01' })).toBe(false)
})

test('filterShelf all hides a piece fired 15 days ago but keeps one fired 13 days ago', () => {
  expect(ids(filterShelf(all, 'all', NOW))).toEqual(['f13', 't'])
})

test('filterShelf fired shows both', () => {
  expect(ids(filterShelf(all, 'fired', NOW))).toEqual(['f13', 'f15'])
})

test('filterShelf all hides lost; lost shows only lost', () => {
  expect(ids(filterShelf(all, 'all', NOW))).not.toContain('l')
  expect(ids(filterShelf(all, 'lost', NOW))).toEqual(['l'])
  expect(ids(filterShelf(all, 'thrown', NOW))).toEqual([])
})

test('chipCounts matches filterShelf lengths for every chip', () => {
  const counts = chipCounts(all, NOW)
  for (const chip of [
    'all',
    'thrown',
    'trimmed',
    'bisqued',
    'glazed',
    'fired',
    'lost',
  ] as const) {
    expect(counts[chip]).toBe(filterShelf(all, chip, NOW).length)
  }
})

test('a piece with no entries appears under All only', () => {
  const bare = view('b', [])
  expect(ids(filterShelf([bare], 'all', NOW))).toEqual(['b'])
  expect(chipCounts([bare], NOW)).toMatchObject({ all: 1, thrown: 0, lost: 0 })
})

describe('buildPieceViews', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await ensureDefaults()
  })

  async function load() {
    const [pieces, entries, apps, glazes, clays] = await Promise.all([
      db.pieces.toArray(),
      db.entries.toArray(),
      db.glazeApps.toArray(),
      db.glazes.toArray(),
      db.clays.toArray(),
    ])
    return buildPieceViews(pieces, entries, apps, glazes, clays)
  }

  test('joins clay, glaze names in order, and marks retired rows', async () => {
    await db.glazes.bulkAdd([
      { id: 'g1', name: 'Celadon', color: '#9DBBAA' },
      { id: 'g2', name: 'Tenmoku', color: '#3A2A20', deletedAt: '2026-11-02' },
    ])
    await db.clays.add({ id: 'c1', name: 'Porcelain', deletedAt: '2026-11-02' })
    const id = await createPiece({ name: 'Mug', clayId: 'c1' })
    await addStageEntry({
      pieceId: id,
      stage: 'glazed',
      glazes: [{ glazeId: 'g2' }, { glazeId: 'g1' }],
    })
    const [v] = await load()
    expect(v.stage).toBe('glazed')
    expect(v.clayName).toBe('Porcelain (retired)')
    expect(v.glazeNames).toEqual(['Tenmoku (retired)', 'Celadon'])
    expect(v.glazeLayers).toEqual([
      { name: 'Tenmoku (retired)', color: '#3A2A20' },
      { name: 'Celadon', color: '#9DBBAA' },
    ])
  })

  test('ignores deleted pieces, deleted entries and their glaze applications', async () => {
    await db.glazes.add({ id: 'g1', name: 'Celadon', color: '#9DBBAA' })
    const gone = await createPiece({ name: 'Gone' })
    const kept = await createPiece({ name: 'Kept' })
    const glazedId = await addStageEntry({
      pieceId: kept,
      stage: 'glazed',
      glazes: [{ glazeId: 'g1' }],
    })
    await softDelete('pieces', gone)
    await softDelete('entries', glazedId)
    const views = await load()
    expect(views.map((v) => v.piece.id)).toEqual([kept])
    // Deleting the Glazed step leaves the filled Trimmed and Bisqued steps.
    expect(views[0].stage).toBe('bisqued')
    expect(views[0].glazeNames).toEqual([])
    expect(views[0].glazeLayers).toEqual([])
  })

  test("a deleted glaze layer doesn't show", async () => {
    await db.glazes.bulkAdd([
      { id: 'g1', name: 'Celadon', color: '#9DBBAA' },
      { id: 'g2', name: 'Tenmoku', color: '#3A2A20' },
    ])
    const id = await createPiece({
      name: 'Mug',
      stage: 'glazed',
      glazes: [{ glazeId: 'g2' }, { glazeId: 'g1' }],
    })
    const tenmoku = await db.glazeApps.where('glazeId').equals('g2').first()
    await db.glazeApps.update(tenmoku?.id as string, {
      deletedAt: '2026-11-08T10:00:00.000Z',
    })
    const [v] = await load()
    expect(v.piece.id).toBe(id)
    expect(v.glazeNames).toEqual(['Celadon'])
    expect(v.glazeLayers).toEqual([{ name: 'Celadon', color: '#9DBBAA' }])
  })

  test('latestPhotoId is the newest live entry that has a photo', async () => {
    const id = await createPiece({ name: 'P' })
    const first = await db.entries.where('pieceId').equals(id).first()
    await db.entries.update(first?.id as string, { photoId: 'ph1' })
    await addStageEntry({ pieceId: id, stage: 'trimmed' })
    const [v] = await load()
    expect(v.latestPhotoId).toBe('ph1')
  })
})

test('filterShelf all hides a Fired piece whose Fired step has no date; fired still shows it', () => {
  const undated: PieceView = {
    ...view('u', [['fired', daysAgo(1)]]),
    entries: [{ id: 'u-0', pieceId: 'u', stage: 'fired' }],
  }
  expect(ids(filterShelf([undated], 'all', NOW))).toEqual([])
  expect(ids(filterShelf([undated], 'fired', NOW))).toEqual(['u'])
})
