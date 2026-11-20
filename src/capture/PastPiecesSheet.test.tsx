import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PastLayer, PastPiece } from '../glazes/pastPieces'
import { PastPiecesSheet } from './PastPiecesSheet'

const thisYear = new Date().getFullYear()

const layer = (
  glazeId: string,
  name: string,
  extra: Partial<PastLayer> = {},
): PastLayer => ({ glazeId, name, color: '#abcdef', live: true, ...extra })

const pieces: PastPiece[] = [
  {
    pieceId: 'bowl',
    name: 'Soup bowl',
    photoId: 'ph-bowl',
    firedDate: `${thisYear}-10-22T12:00:00Z`,
    layers: [
      layer('c', 'Celadon', { dips: 2, method: 'dip' }),
      layer('t', 'Tenmoku', { dips: 1, method: 'pour', note: 'thin at rim' }),
    ],
    label: 'Celadon over Tenmoku',
  },
  {
    pieceId: 'mug',
    name: 'Stacking mug',
    photoId: 'ph-mug',
    firedDate: `${thisYear}-09-10T12:00:00Z`,
    layers: [layer('h', 'Chun'), layer('c', 'Celadon'), layer('t', 'Tenmoku')],
    label: 'Chun over Celadon over Tenmoku',
  },
  {
    pieceId: 'vase',
    name: 'Bud vase',
    photoId: 'ph-vase',
    firedDate: `${thisYear}-09-01T12:00:00Z`,
    layers: [layer('s', 'Shino')],
    label: 'Shino',
  },
]

const sheet = () => screen.getByRole('dialog', { name: 'Past pieces' })
const chip = (name: string) =>
  within(sheet()).getByRole('button', { name, pressed: undefined })
const photos = () =>
  within(sheet()).queryAllByRole('button', { name: /^[^:]+: / })
const chipNames = () =>
  within(sheet())
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('aria-pressed'))
    .map((b) => b.textContent)

function renderSheet(onUse = vi.fn(), onClose = vi.fn()) {
  render(<PastPiecesSheet pieces={pieces} onUse={onUse} onClose={onClose} />)
  return { onUse, onClose }
}

test('opens on All with every past piece', () => {
  renderSheet()
  expect(chip('All')).toHaveAttribute('aria-pressed', 'true')
  expect(photos().map((b) => b.getAttribute('aria-label'))).toEqual([
    'Soup bowl: Celadon over Tenmoku',
    'Stacking mug: Chun over Celadon over Tenmoku',
    'Bud vase: Shino',
  ])
  expect(within(sheet()).queryByText(/pieces? with/)).toBeNull()
})

test('glaze chips narrow to pieces with every chosen glaze', async () => {
  renderSheet()
  await userEvent.click(chip('Celadon'))
  expect(photos()).toHaveLength(2)
  expect(within(sheet()).getByText('2 pieces with Celadon')).toBeVisible()
  expect(chip('All')).toHaveAttribute('aria-pressed', 'false')

  await userEvent.click(chip('Chun'))
  expect(photos()).toHaveLength(1)
  expect(
    within(sheet()).getByText('1 piece with Celadon and Chun'),
  ).toBeVisible()

  await userEvent.click(chip('Chun'))
  expect(photos()).toHaveLength(2)

  await userEvent.click(chip('All'))
  expect(photos()).toHaveLength(3)
  expect(within(sheet()).queryByText(/pieces? with/)).toBeNull()
})

test('no match says so, and the chips still widen it', async () => {
  renderSheet()
  await userEvent.click(chip('Shino'))
  await userEvent.click(chip('Celadon'))
  expect(photos()).toHaveLength(0)
  expect(
    within(sheet()).getByText('No pieces with both Shino and Celadon'),
  ).toBeVisible()
  await userEvent.click(chip('Shino'))
  expect(photos()).toHaveLength(2)
})

test("pressing a chip doesn't reorder the chips", async () => {
  renderSheet()
  const before = chipNames()
  expect(before).toEqual(['All', 'Celadon', 'Chun', 'Shino', 'Tenmoku'])
  await userEvent.click(chip('Tenmoku'))
  expect(chipNames()).toEqual(before)
})

test('the closer look shows the recipe and uses it', async () => {
  const { onUse } = renderSheet()
  await userEvent.click(
    screen.getByRole('button', { name: 'Soup bowl: Celadon over Tenmoku' }),
  )
  const card = screen.getByRole('dialog', { name: 'Soup bowl' })
  expect(within(card).getByText('Fired Oct 22')).toBeVisible()
  expect(within(card).getByText('2 dips · Dip')).toBeVisible()
  expect(within(card).getByText('1 dip · Pour · thin at rim')).toBeVisible()
  await userEvent.click(
    within(card).getByRole('button', { name: 'Use these glazes' }),
  )
  expect(onUse).toHaveBeenCalledWith(pieces[0])
})

test('Back to pieces keeps the chosen chips', async () => {
  renderSheet()
  await userEvent.click(chip('Celadon'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Soup bowl: Celadon over Tenmoku' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Back to pieces' }))
  expect(screen.queryByRole('dialog', { name: 'Soup bowl' })).toBeNull()
  expect(chip('Celadon')).toHaveAttribute('aria-pressed', 'true')
  expect(photos()).toHaveLength(2)
})

test('Escape closes the closer look first, then the sheet', async () => {
  const { onClose } = renderSheet()
  await userEvent.click(screen.getByRole('button', { name: 'Bud vase: Shino' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Bud vase' })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})
