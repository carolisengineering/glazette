import { buildPieceViews } from '../db/queries'
import type { Glaze, GlazeApplication, Piece, StageEntry } from '../db/types'
import { buildGlazeViews, centerCropStyle } from './swatch'

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...extra,
})
const entry = (
  id: string,
  pieceId: string,
  stage: StageEntry['stage'],
  date: string,
  extra: Partial<StageEntry> = {},
): StageEntry => ({ id, pieceId, stage, date, ...extra })
const app = (
  entryId: string,
  pieceId: string,
  glazeId: string,
): GlazeApplication => ({
  id: `app-${entryId}-${glazeId}`,
  entryId,
  pieceId,
  glazeId,
  order: 0,
})
const glaze = (
  id: string,
  name: string,
  extra: Partial<Glaze> = {},
): Glaze => ({ id, name, color: '#fff', ...extra })

function views(
  pieces: Piece[],
  entries: StageEntry[],
  apps: GlazeApplication[],
  glazes: Glaze[],
) {
  return buildGlazeViews(
    buildPieceViews(pieces, entries, apps, glazes, []),
    apps,
    glazes,
  )
}

test('swatchPhotoId is the newest fired photo among pieces using the glaze, undefined when none fired', () => {
  const glazes = [glaze('g1', 'Celadon'), glaze('g2', 'Tenmoku')]
  const pieces = [piece('a'), piece('b'), piece('c')]
  const entries = [
    entry('ag', 'a', 'glazed', '2026-10-02'),
    entry('af', 'a', 'fired', '2026-10-10', { photoId: 'old' }),
    entry('bg', 'b', 'glazed', '2026-10-03'),
    entry('bf', 'b', 'fired', '2026-10-20', { photoId: 'new' }),
    entry('bf2', 'b', 'fired', '2026-10-25'), // newer but no photo
    entry('cg', 'c', 'glazed', '2026-10-04', { photoId: 'glazedOnly' }),
  ]
  const apps = [
    app('ag', 'a', 'g1'),
    app('bg', 'b', 'g1'),
    app('cg', 'c', 'g2'),
  ]
  const result = views(pieces, entries, apps, glazes)
  const celadon = result.find((v) => v.glaze.id === 'g1')
  expect(celadon?.swatchPhotoId).toBe('new')
  expect([...(celadon?.pieceIds ?? [])].sort()).toEqual(['a', 'b'])
  expect(celadon?.pieces.map((v) => v.piece.id).sort()).toEqual(['a', 'b'])
  const tenmoku = result.find((v) => v.glaze.id === 'g2')
  expect(tenmoku?.swatchPhotoId).toBeUndefined()
})

test('lists live glazes alphabetically, counts lost pieces, skips deleted pieces and glazes', () => {
  const glazes = [
    glaze('g1', 'oatmeal'),
    glaze('g2', 'Celadon'),
    glaze('g3', 'Gone', { deletedAt: '2026-10-05' }),
  ]
  const pieces = [
    piece('a', { lost: true }),
    piece('b', { deletedAt: '2026-10-05' }),
  ]
  const entries = [
    entry('ag', 'a', 'glazed', '2026-10-02'),
    entry('bg', 'b', 'glazed', '2026-10-02'),
  ]
  const apps = [
    app('ag', 'a', 'g1'),
    app('bg', 'b', 'g1'),
    app('ag', 'a', 'g3'),
  ]
  const result = views(pieces, entries, apps, glazes)
  expect(result.map((v) => v.glaze.name)).toEqual(['Celadon', 'oatmeal'])
  expect(result[1].pieceIds).toEqual(['a'])
})

test('only the latest glazed entry counts toward a glaze', () => {
  const glazes = [glaze('g1', 'Old'), glaze('g2', 'New')]
  const entries = [
    entry('e1', 'a', 'glazed', '2026-10-02'),
    entry('e2', 'a', 'glazed', '2026-10-09'),
  ]
  const result = views(
    [piece('a')],
    entries,
    [app('e1', 'a', 'g1'), app('e2', 'a', 'g2')],
    glazes,
  )
  expect(result.find((v) => v.glaze.id === 'g1')?.pieceIds).toEqual([])
  expect(result.find((v) => v.glaze.id === 'g2')?.pieceIds).toEqual(['a'])
})

test('centerCropStyle covers a square tile from the center', () => {
  expect(centerCropStyle(800, 600)).toMatchObject({
    objectFit: 'cover',
    objectPosition: 'center',
    width: '100%',
    height: '100%',
  })
})

test.each([
  ['bare Glazed step first', true],
  ['bare Glazed step last', false],
])(
  'tied undated Glazed steps: glazes come from the one that has them (%s)',
  (_label, bareFirst) => {
    const glazes = [glaze('g1', 'Celadon', { color: '#abc' })]
    const bare: StageEntry = { id: 'bare', pieceId: 'a', stage: 'glazed' }
    const withGlazes: StageEntry = { id: 'full', pieceId: 'a', stage: 'glazed' }
    const entries = bareFirst ? [bare, withGlazes] : [withGlazes, bare]
    const apps = [app('full', 'a', 'g1')]
    const pieceViews = buildPieceViews([piece('a')], entries, apps, glazes, [])
    expect(pieceViews[0].glazeNames).toEqual(['Celadon'])
    expect(pieceViews[0].glazeColor).toBe('#abc')
    const result = buildGlazeViews(pieceViews, apps, glazes)
    expect(result[0].pieceIds).toEqual(['a'])
  },
)
