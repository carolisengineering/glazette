import { buildPieceViews } from '../db/queries'
import type {
  Combo,
  Glaze,
  GlazeApplication,
  Piece,
  StageEntry,
} from '../db/types'
import { buildComboViews, comboCountWith, comboStrips } from './combos'

const glaze = (
  id: string,
  name: string,
  extra: Partial<Glaze> = {},
): Glaze => ({ id, name, color: '#fff', ...extra })
const combo = (layers: string[], extra: Partial<Combo> = {}): Combo => ({
  id: `combo-${layers.join('-')}`,
  layers,
  swatchPhotoId: 'p',
  ...extra,
})
const piece = (id: string): Piece => ({
  id,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
})
const glazedEntry = (pieceId: string): StageEntry => ({
  id: `e-${pieceId}`,
  pieceId,
  stage: 'glazed',
  date: '2026-10-02',
})
const apps = (pieceId: string, ids: string[]): GlazeApplication[] =>
  ids.map((glazeId, order) => ({
    id: `app-${pieceId}-${order}`,
    entryId: `e-${pieceId}`,
    pieceId,
    glazeId,
    order,
    dips: 3,
    method: 'dip',
  })) as GlazeApplication[]

const G = [glaze('g1', 'Celadon'), glaze('g2', 'Tenmoku'), glaze('g3', 'Chun')]

function build(
  combos: Combo[],
  glazes: Glaze[] = G,
  ga: GlazeApplication[] = [],
) {
  const pieces = [...new Set(ga.map((a) => a.pieceId))].map(piece)
  const entries = pieces.map((p) => glazedEntry(p.id))
  const pv = buildPieceViews(pieces, entries, ga, glazes, [])
  return buildComboViews(combos, glazes, pv, ga)
}

test('names a combo by its layers, top first', () => {
  const [v] = build([combo(['g3', 'g1', 'g2'])])
  expect(v.name).toBe('Chun over Celadon over Tenmoku')
  expect(v.label).toEqual({ top: 'Chun', over: 'over Celadon' })
  expect(v.layers.map((g) => g.id)).toEqual(['g3', 'g1', 'g2'])
  const [two] = build([combo(['g1', 'g2'])])
  expect(two.name).toBe('Celadon over Tenmoku')
  expect(two.label).toEqual({ top: 'Celadon' })
})

test('names follow a renamed glaze', () => {
  const glazes = [glaze('g1', 'Seladon'), G[1]]
  expect(build([combo(['g1', 'g2'])], glazes)[0].name).toBe(
    'Seladon over Tenmoku',
  )
})

test('hides a combo whose layer glaze is deleted or missing', () => {
  const deleted = [G[0], glaze('g2', 'Tenmoku', { deletedAt: 'x' }), G[2]]
  expect(build([combo(['g1', 'g2'])], deleted)).toEqual([])
  expect(build([combo(['g1', 'gone'])])).toEqual([])
  expect(build([combo(['g1', 'g3'])])).toHaveLength(1)
})

test('hides a deleted combo', () => {
  expect(build([combo(['g1', 'g2'], { deletedAt: 'x' })])).toEqual([])
})

test("counts pieces whose glaze step has exactly the combo's layers in order", () => {
  const ga = [
    ...apps('a', ['g1', 'g2']),
    ...apps('b', ['g2', 'g1']),
    ...apps('c', ['g1', 'g2', 'g3']),
    ...apps('d', ['g1', 'g2']).map((a) => ({ ...a, dips: 1, method: 'brush' })),
    ...apps('e', ['g1', 'g3', 'g2']).map((a) =>
      a.glazeId === 'g3' ? { ...a, deletedAt: 'x' } : a,
    ),
  ] as GlazeApplication[]
  const [v] = build([combo(['g1', 'g2'])], G, ga)
  expect(v.pieces.map((p) => p.piece.id).sort()).toEqual(['a', 'd', 'e'])
})

test('strips go by bottom glaze, alphabetical, tiles alphabetical by label', () => {
  const glazes = [...G, glaze('g4', 'Amber')]
  const views = build(
    [
      combo(['g3', 'g1', 'g2']), // Chun over Celadon, bottom g2
      combo(['g3', 'g2']), // Chun, bottom g2
      combo(['g1', 'g2']), // Celadon, bottom g2
      combo(['g4', 'g1']), // Amber, bottom g1
    ],
    glazes,
  )
  const strips = comboStrips(views)
  expect(strips.map((s) => s.bottom.name)).toEqual(['Celadon', 'Tenmoku'])
  expect(strips[1].combos.map((c) => c.name)).toEqual([
    'Celadon over Tenmoku',
    'Chun over Tenmoku',
    'Chun over Celadon over Tenmoku',
  ])
})

test('comboCountWith counts every layer position and skips deleted combos', () => {
  const combos = [
    combo(['g1', 'g2']),
    combo(['g2', 'g3']),
    combo(['g3', 'g1', 'g2']),
    combo(['g1', 'g3'], { deletedAt: 'x' }),
  ]
  expect(comboCountWith('g1', combos)).toBe(2 + 0)
  expect(comboCountWith('g2', combos)).toBe(3)
  expect(comboCountWith('g3', combos)).toBe(2)
  expect(comboCountWith('zz', combos)).toBe(0)
})
