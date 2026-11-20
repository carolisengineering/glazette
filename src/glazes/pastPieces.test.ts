import { renderHook, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { buildPieceViews } from '../db/queries'
import type { Glaze, GlazeApplication, Piece, StageEntry } from '../db/types'
import { realBlobs } from '../test/realBlobs'
import {
  buildPastPieces,
  countLine,
  filterPastPieces,
  firedLabel,
  monthLabel,
  type PastPiece,
  pastChips,
  rowsFromPastPiece,
  usePastPieces,
} from './pastPieces'

realBlobs().watch(db)

const glaze = (
  id: string,
  name: string,
  extra: Partial<Glaze> = {},
): Glaze => ({ id, name, color: '#abcdef', ...extra })
const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  name: id,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...extra,
})
const entry = (
  id: string,
  pieceId: string,
  stage: StageEntry['stage'],
  extra: Partial<StageEntry> = {},
): StageEntry => ({ id, pieceId, stage, ...extra })
const app = (
  pieceId: string,
  entryId: string,
  glazeId: string,
  order: number,
  extra: Partial<GlazeApplication> = {},
): GlazeApplication => ({
  id: `a-${entryId}-${order}`,
  entryId,
  pieceId,
  glazeId,
  order,
  ...extra,
})

const glazes = [
  glaze('c', 'Celadon'),
  glaze('t', 'Tenmoku'),
  glaze('h', 'Chun'),
  glaze('s', 'Shino'),
  glaze('x', 'Ash', { deletedAt: '2026-11-01T00:00:00Z' }),
]

/** A piece glazed with `layers` (top first) and fired with one photo. */
function glazedAndFired(
  id: string,
  layers: string[],
  firedDate: string | undefined,
  extra: Partial<Piece> = {},
) {
  return {
    piece: piece(id, extra),
    entries: [
      entry(`g-${id}`, id, 'glazed', { date: '2026-09-01T12:00:00Z' }),
      entry(`f-${id}`, id, 'fired', {
        date: firedDate,
        photoId: `ph-${id}`,
      }),
    ],
    apps: layers.map((g, i) => app(id, `g-${id}`, g, i)),
  }
}

function build(
  items: ReturnType<typeof glazedAndFired>[],
  exclude?: string,
  extraEntries: StageEntry[] = [],
  extraApps: GlazeApplication[] = [],
  library: Glaze[] = glazes,
): PastPiece[] {
  const entries = [...items.flatMap((i) => i.entries), ...extraEntries]
  const ga = [...items.flatMap((i) => i.apps), ...extraApps]
  const views = buildPieceViews(
    items.map((i) => i.piece),
    entries,
    ga,
    library,
    [],
  )
  return buildPastPieces(views, ga, library, exclude)
}

describe('buildPastPieces', () => {
  it('returns a glazed and fired piece with its recipe, top first', () => {
    const bowl = glazedAndFired('Soup bowl', [], '2026-10-22T12:00:00Z')
    bowl.apps = [
      app('Soup bowl', 'g-Soup bowl', 't', 1, { note: 'thin at rim' }),
      app('Soup bowl', 'g-Soup bowl', 'c', 0, { dips: 2, method: 'dip' }),
    ]
    const [past] = build([bowl])
    expect(past).toMatchObject({
      pieceId: 'Soup bowl',
      name: 'Soup bowl',
      photoId: 'ph-Soup bowl',
      firedDate: '2026-10-22T12:00:00Z',
      label: 'Celadon over Tenmoku',
    })
    expect(past.layers).toEqual([
      {
        glazeId: 'c',
        name: 'Celadon',
        color: '#abcdef',
        live: true,
        dips: 2,
        method: 'dip',
      },
      {
        glazeId: 't',
        name: 'Tenmoku',
        color: '#abcdef',
        live: true,
        note: 'thin at rim',
      },
    ])
  })

  it('shows a piece once, with its newest fired photo', () => {
    const mug = glazedAndFired('mug', ['c'], '2026-10-01T12:00:00Z')
    const later = entry('f2', 'mug', 'fired', {
      date: '2026-10-20T12:00:00Z',
      photoId: 'ph-later',
    })
    const out = build([mug], undefined, [later])
    expect(out).toHaveLength(1)
    expect(out[0].photoId).toBe('ph-later')
    expect(out[0].firedDate).toBe('2026-10-20T12:00:00Z')
  })

  it('leaves out pieces that are not fired with a photo, or have no glazes', () => {
    const glazedOnly = {
      piece: piece('glazed-only'),
      entries: [entry('g1', 'glazed-only', 'glazed')],
      apps: [app('glazed-only', 'g1', 'c', 0)],
    }
    const firedNoPhoto = {
      piece: piece('no-photo'),
      entries: [
        entry('g2', 'no-photo', 'glazed'),
        entry('f2', 'no-photo', 'fired'),
      ],
      apps: [app('no-photo', 'g2', 'c', 0)],
    }
    const noGlazes = glazedAndFired('bare', [], '2026-10-01T12:00:00Z')
    expect(build([glazedOnly, firedNoPhoto, noGlazes])).toEqual([])
  })

  it('leaves out the piece being edited', () => {
    const a = glazedAndFired('a', ['c'], '2026-10-01T12:00:00Z')
    const b = glazedAndFired('b', ['t'], '2026-10-02T12:00:00Z')
    expect(build([a, b], 'b').map((p) => p.pieceId)).toEqual(['a'])
  })

  it("leaves out a piece with a glaze that isn't on this device yet", () => {
    const a = glazedAndFired('a', ['c', 'not-synced'], '2026-10-01T12:00:00Z')
    expect(build([a])).toEqual([])
  })

  it('keeps a deleted glaze by its old name, marked not live', () => {
    const a = glazedAndFired('a', ['x', 'c'], '2026-10-01T12:00:00Z')
    const [past] = build([a])
    expect(past.label).toBe('Ash over Celadon')
    expect(past.layers[0]).toMatchObject({
      glazeId: 'x',
      name: 'Ash',
      live: false,
    })
  })

  it('still shows a lost piece with a fired photo', () => {
    const a = glazedAndFired('a', ['c'], '2026-10-01T12:00:00Z', {
      lost: true,
    })
    expect(build([a]).map((p) => p.pieceId)).toEqual(['a'])
  })

  it('puts the newest fired first, and undated ones last', () => {
    const old = glazedAndFired('old', ['c'], '2026-08-01T12:00:00Z')
    const undated = glazedAndFired('undated', ['c'], undefined)
    const recent = glazedAndFired('recent', ['c'], '2026-10-01T12:00:00Z')
    expect(build([old, undated, recent]).map((p) => p.pieceId)).toEqual([
      'recent',
      'old',
      'undated',
    ])
  })
})

describe('chips and narrowing', () => {
  const pieces = build([
    glazedAndFired('a', ['c', 't'], '2026-10-03T12:00:00Z'),
    glazedAndFired('b', ['h', 'c', 't'], '2026-10-02T12:00:00Z'),
    glazedAndFired('c', ['s', 'x'], '2026-10-01T12:00:00Z'),
  ])

  it('lists each live glaze on the pieces once, alphabetical', () => {
    expect(pastChips(pieces).map((c) => c.name)).toEqual([
      'Celadon',
      'Chun',
      'Shino',
      'Tenmoku',
    ])
  })

  it('narrows to pieces with every chosen glaze, in any layer', () => {
    const ids = (g: string[]) =>
      filterPastPieces(pieces, g).map((p) => p.pieceId)
    expect(ids(['c'])).toEqual(['a', 'b'])
    expect(ids(['c', 'h'])).toEqual(['b'])
    expect(ids([])).toEqual(['a', 'b', 'c'])
  })
})

test('countLine', () => {
  expect(countLine(3, ['Celadon'])).toBe('3 pieces with Celadon')
  expect(countLine(1, ['Celadon', 'Chun'])).toBe(
    '1 piece with Celadon and Chun',
  )
  expect(countLine(2, ['Celadon', 'Chun', 'Tenmoku'])).toBe(
    '2 pieces with Celadon, Chun and Tenmoku',
  )
  expect(countLine(0, ['Celadon', 'Chun'])).toBe(
    'No pieces with both Celadon and Chun',
  )
  expect(countLine(0, ['Celadon'])).toBe('No pieces with Celadon')
})

test('month and fired labels add the year only when it differs', () => {
  const now = new Date('2026-11-20T12:00:00')
  expect(monthLabel('2026-10-22T12:00:00.000Z', now)).toBe('Oct')
  expect(monthLabel('2025-10-22T12:00:00.000Z', now)).toBe('Oct 2025')
  expect(monthLabel(undefined, now)).toBeUndefined()
  expect(firedLabel('2026-10-22T12:00:00.000Z', now)).toBe('Fired Oct 22')
  expect(firedLabel('2025-10-22T12:00:00.000Z', now)).toBe('Fired Oct 22, 2025')
  expect(firedLabel(undefined, now)).toBeUndefined()
})

test('rowsFromPastPiece copies glazes, dips, method and note', () => {
  const bowl = glazedAndFired('bowl', [], '2026-10-22T12:00:00Z')
  bowl.apps = [
    app('bowl', 'g-bowl', 'c', 0, { dips: 2, method: 'dip' }),
    app('bowl', 'g-bowl', 't', 1, { note: 'thin at rim' }),
    app('bowl', 'g-bowl', 'x', 2),
  ]
  const rows = rowsFromPastPiece(build([bowl])[0])
  expect(rows.map(({ key, ...r }) => r)).toEqual([
    { glazeId: 'c', name: 'Celadon', dips: 2, method: 'dip' },
    { glazeId: 't', name: 'Tenmoku', note: 'thin at rim' },
    { name: 'Ash' },
  ])
  expect(new Set(rows.map((r) => r.key)).size).toBe(3)
})

describe('usePastPieces', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  const photo = (id: string, hash: string) => ({
    id,
    hash,
    width: 3000,
    height: 4000,
    takenAt: '2026-11-01T00:00:00.000Z',
  })

  it("leaves out a piece whose photo isn't on this device", async () => {
    const here = glazedAndFired('here', ['c'], '2026-10-02T12:00:00Z')
    const later = glazedAndFired('later', ['c'], '2026-10-03T12:00:00Z')
    const missing = glazedAndFired('missing', ['c'], '2026-10-04T12:00:00Z')
    await db.glazes.bulkAdd(glazes)
    await db.pieces.bulkAdd([here.piece, later.piece, missing.piece])
    await db.entries.bulkAdd([
      ...here.entries,
      ...later.entries,
      ...missing.entries,
    ])
    await db.glazeApps.bulkAdd([...here.apps, ...later.apps, ...missing.apps])
    await db.photos.bulkAdd([
      photo('ph-here', 'h1'),
      { ...photo('ph-later', 'h2'), needsDownload: 1 as const },
    ])
    await db.photoBytes.add({
      hash: 'h1',
      blob: new Blob(['full']),
      thumb: new Blob(['th']),
    })
    const { result } = renderHook(() => usePastPieces())
    await waitFor(() =>
      expect(result.current?.map((p) => p.pieceId)).toEqual(['here']),
    )
  })

  it('leaves out the piece it is given', async () => {
    const a = glazedAndFired('a', ['c'], '2026-10-02T12:00:00Z')
    await db.glazes.bulkAdd(glazes)
    await db.pieces.add(a.piece)
    await db.entries.bulkAdd(a.entries)
    await db.glazeApps.bulkAdd(a.apps)
    await db.photos.add(photo('ph-a', 'h1'))
    await db.photoBytes.add({
      hash: 'h1',
      blob: new Blob(['full']),
      thumb: new Blob(['th']),
    })
    const { result } = renderHook(() => usePastPieces('a'))
    await waitFor(() => expect(result.current).toEqual([]))
  })
})
