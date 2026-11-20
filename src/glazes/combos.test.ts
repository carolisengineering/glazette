import { buildPieceViews } from '../db/queries'
import type {
  Combo,
  Glaze,
  GlazeApplication,
  Piece,
  StageEntry,
} from '../db/types'
import {
  buildComboViews,
  comboCountWith,
  comboPhotoChoices,
  comboStrips,
  shownComboViews,
} from './combos'

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

test('shownComboViews hides combos as buildComboViews does, without pieces', () => {
  const glazes = [G[0], glaze('g2', 'Tenmoku', { deletedAt: 'x' }), G[2]]
  const combos = [
    combo(['g1', 'g2']),
    combo(['g1', 'gone']),
    combo(['g1', 'g3'], { deletedAt: 'x' }),
    combo(['g3', 'g1']),
  ]
  const views = shownComboViews(combos, glazes)
  expect(views.map((v) => v.name)).toEqual(['Chun over Celadon'])
  expect(views[0].pieces).toEqual([])
  expect(views.map((v) => v.combo.id)).toEqual(
    build(combos, glazes).map((v) => v.combo.id),
  )
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
  const glazes = [glaze('g1', 'A'), glaze('g2', 'B'), glaze('g3', 'C')]
  const combos = [
    combo(['g1', 'g2']),
    combo(['g2', 'g3']),
    combo(['g3', 'g1', 'g2']),
    combo(['g1', 'g3'], { deletedAt: 'x' }),
  ]
  expect(comboCountWith('g1', combos, glazes)).toBe(2 + 0)
  expect(comboCountWith('g2', combos, glazes)).toBe(3)
  expect(comboCountWith('g3', combos, glazes)).toBe(2)
  expect(comboCountWith('zz', combos, glazes)).toBe(0)
})

test('comboCountWith skips combos already hidden by another deleted glaze', () => {
  // "X over Z" with Z deleted is already hidden, so deleting X hides nothing more.
  const glazes = [
    glaze('x', 'X'),
    glaze('y', 'Y'),
    glaze('z', 'Z', { deletedAt: 'gone' }),
  ]
  const combos = [combo(['x', 'z']), combo(['x', 'y']), combo(['y', 'x', 'z'])]
  expect(comboCountWith('x', combos, glazes)).toBe(1)
  expect(comboCountWith('z', combos, glazes)).toBe(0)
})

const fired = (
  pieceId: string,
  photoId: string | undefined,
  date: string,
  extra: Partial<StageEntry> = {},
): StageEntry => ({
  id: `f-${pieceId}-${photoId}-${date}`,
  pieceId,
  stage: 'fired',
  photoId,
  date,
  ...extra,
})

function choicesFor(only?: string[]) {
  const glazes = [
    ...G,
    glaze('g4', 'Gone', { deletedAt: 'x' }),
    glaze('g5', 'Shino'),
  ]
  const ga = [
    ...apps('one', ['g1']),
    ...apps('four', ['g1', 'g2', 'g3', 'g5']),
    ...apps('dead', ['g1', 'g4']),
    ...apps('two', ['g1', 'g2']),
    ...apps('flip', ['g2', 'g1']),
    ...apps('rep', ['g1', 'g2', 'g1']),
    ...apps('three', ['g3', 'g1', 'g2']),
  ]
  const ids = [...new Set(ga.map((a) => a.pieceId))]
  const entries = [
    ...ids.map(glazedEntry),
    fired('one', 'p-one', '2026-10-20'),
    fired('four', 'p-four', '2026-10-20'),
    fired('dead', 'p-dead', '2026-10-20'),
    fired('two', 'p-two-old', '2026-10-03'),
    fired('two', 'p-two-new', '2026-10-09'),
    fired('two', 'p-two-gone', '2026-10-19', { deletedAt: 'x' }),
    fired('flip', 'p-flip', '2026-10-04'),
    fired('rep', 'p-rep', '2026-10-07'),
    fired('three', 'p-three', '2026-10-08'),
    fired('three', undefined, '2026-10-18'),
    // The same photo on an older step is listed once, where it's newest.
    fired('three', 'p-three', '2026-10-05'),
  ]
  const pv = buildPieceViews(ids.map(piece), entries, ga, glazes, [])
  return comboPhotoChoices(pv, ga, glazes, only)
}

test('photo choices take fired photos of pieces with 2–3 live glazes', () => {
  expect(choicesFor()).toEqual([
    {
      photoId: 'p-two-new',
      layers: ['g1', 'g2'],
      name: 'Celadon over Tenmoku',
    },
    {
      photoId: 'p-three',
      layers: ['g3', 'g1', 'g2'],
      name: 'Chun over Celadon over Tenmoku',
    },
    {
      photoId: 'p-rep',
      layers: ['g1', 'g2', 'g1'],
      name: 'Celadon over Tenmoku over Celadon',
    },
    { photoId: 'p-flip', layers: ['g2', 'g1'], name: 'Tenmoku over Celadon' },
    {
      photoId: 'p-two-old',
      layers: ['g1', 'g2'],
      name: 'Celadon over Tenmoku',
    },
  ])
})

test('only narrows to one stack', () => {
  expect(choicesFor(['g1', 'g2']).map((c) => c.photoId)).toEqual([
    'p-two-new',
    'p-two-old',
  ])
  expect(choicesFor(['g3', 'g2'])).toEqual([])
})
