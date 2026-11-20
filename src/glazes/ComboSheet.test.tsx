import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { comboId } from '../db/combos'
import { db, newId } from '../db/db'
import { ensureDefaults } from '../db/ops'
import type { Combo, Glaze } from '../db/types'
import type { ProcessedImage } from '../photos/process'
import { processImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import { makeSwatch } from '../photos/swatchImage'
import { ComboSheet } from './ComboSheet'

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))
vi.mock('../photos/swatchImage', () => ({ makeSwatch: vi.fn() }))
vi.mock('../components/PhotoImg', () => ({
  PhotoImg: ({ photoId, alt }: { photoId?: string; alt?: string }) => (
    <img data-photo-id={photoId} alt={alt} />
  ),
}))

function photo(tag: string): ProcessedImage {
  return {
    blob: new Blob([tag], { type: 'image/jpeg' }),
    thumb: new Blob([`t${tag}`], { type: 'image/jpeg' }),
    hash: `hash-${tag}`,
    width: 4000,
    height: 3000,
    takenAt: new Date().toISOString(),
  }
}

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  await db.delete()
  await db.open()
  await ensureDefaults()
  vi.mocked(processImage).mockResolvedValue(photo('new'))
  vi.mocked(makeSwatch).mockResolvedValue({ ...photo('crop'), color: '#abc' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function addGlaze(name: string): Promise<Glaze> {
  const glaze = { id: newId(), name, color: '#D8C7A6' }
  await db.glazes.add(glaze)
  return glaze
}

/** Celadon over Tenmoku, with a swatch photo. */
async function celadonOverTenmoku() {
  const tenmoku = await addGlaze('Tenmoku')
  const celadon = await addGlaze('Celadon')
  const old = await storePhoto(photo('old'))
  await db.photos.update(old, { swatch: 1 })
  const combo: Combo = {
    id: comboId([celadon.id, tenmoku.id]),
    layers: [celadon.id, tenmoku.id],
    swatchPhotoId: old,
  }
  await db.combos.add(combo)
  return { tenmoku, celadon, old, combo }
}

/** A fired piece wearing these glazes, top first, with a photo on this device. */
async function firedPiece(layers: string[], tag: string) {
  const pieceId = newId()
  const now = new Date().toISOString()
  await db.pieces.add({ id: pieceId, createdAt: now, updatedAt: now })
  const glazedId = newId()
  await db.entries.add({
    id: glazedId,
    pieceId,
    stage: 'glazed',
    date: '2026-10-01',
  })
  await db.glazeApps.bulkAdd(
    layers.map((glazeId, order) => ({
      id: newId(),
      entryId: glazedId,
      pieceId,
      glazeId,
      order,
    })),
  )
  const photoId = await storePhoto(photo(tag))
  await db.entries.add({
    id: newId(),
    pieceId,
    stage: 'fired',
    date: '2026-10-10',
    photoId,
  })
  return photoId
}

function setup(combo: Combo, layers: Glaze[]) {
  const onClose = vi.fn()
  render(
    <ComboSheet
      view={{
        combo,
        layers,
        name: layers.map((g) => g.name).join(' over '),
        label: { top: layers[0].name },
        pieces: [],
      }}
      onClose={onClose}
    />,
  )
  return { onClose }
}

test('replace photo keeps the layers', async () => {
  const { tenmoku, celadon, old, combo } = await celadonOverTenmoku()
  const { onClose } = setup(combo, [celadon, tenmoku])
  const sheet = screen.getByRole('dialog', { name: 'Edit combo' })
  expect(within(sheet).getByText('Celadon over Tenmoku')).toBeVisible()
  await userEvent.click(
    within(sheet).getByRole('button', { name: 'Add photo' }),
  )
  fireEvent.change(screen.getByTestId('library-input'), {
    target: { files: [new File(['x'], 'new.jpg', { type: 'image/jpeg' })] },
  })
  const crop = await screen.findByRole('dialog', { name: 'Crop swatch' })
  expect(within(crop).getByRole('button', { name: 'Cancel' })).toBeVisible()
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const saved = await db.combos.get(combo.id)
  expect(saved?.layers).toEqual([celadon.id, tenmoku.id])
  expect(saved?.swatchPhotoId).toBeTruthy()
  expect(saved?.swatchPhotoId).not.toBe(old)
  expect((await db.photos.get(old))?.deletedAt).toBeTruthy()
  expect(await db.combos.count()).toBe(1)
})

test('delete asks, then removes the combo', async () => {
  const { tenmoku, celadon, old, combo } = await celadonOverTenmoku()
  const { onClose } = setup(combo, [celadon, tenmoku])
  await userEvent.click(screen.getByRole('button', { name: 'Delete combo' }))
  const ask = screen.getByRole('dialog', {
    name: 'Delete Celadon over Tenmoku?',
  })
  expect(
    within(ask).getByText('Its photo goes too. Pieces keep their glazes.'),
  ).toBeVisible()
  await userEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect((await db.combos.get(combo.id))?.deletedAt).toBeTruthy()
  expect((await db.photos.get(old))?.deletedAt).toBeTruthy()
})

test('From a piece offers only pieces with this exact stack', async () => {
  const { tenmoku, celadon, combo } = await celadonOverTenmoku()
  const oatmeal = await addGlaze('Oatmeal')
  const match = await firedPiece([celadon.id, tenmoku.id], 'match')
  await firedPiece([tenmoku.id, celadon.id], 'flipped')
  await firedPiece([celadon.id, tenmoku.id, oatmeal.id], 'three')
  setup(combo, [celadon, tenmoku])
  await userEvent.click(
    await screen.findByRole('button', { name: 'From a piece' }),
  )
  const grid = await screen.findByRole('dialog', {
    name: 'Pieces in Celadon over Tenmoku',
  })
  const tiles = within(grid).getAllByRole('button', { name: /^Photo / })
  expect(tiles).toHaveLength(1)
  expect(within(tiles[0]).getByRole('img', { hidden: true })).toHaveAttribute(
    'data-photo-id',
    match,
  )
})
