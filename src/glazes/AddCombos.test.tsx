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
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import type { ProcessedImage } from '../photos/process'
import { processImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import { makeSwatch } from '../photos/swatchImage'
import { AddCombos } from './AddCombos'

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))
vi.mock('../photos/swatchImage', () => ({ makeSwatch: vi.fn() }))
vi.mock('../telemetry/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../telemetry/telemetry')>()),
  track: vi.fn(),
}))
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

let crops = 0
let tiles: ProcessedImage

beforeEach(async () => {
  tiles = photo('tiles')
  URL.createObjectURL = vi.fn((blob: Blob) =>
    blob === tiles.blob ? 'blob:tiles' : 'blob:preview',
  )
  URL.revokeObjectURL = vi.fn()
  await db.delete()
  await db.open()
  await ensureDefaults()
  crops = 0
  vi.mocked(processImage).mockResolvedValue(tiles)
  vi.mocked(makeSwatch).mockImplementation(async () => {
    crops += 1
    return { ...photo(`crop${crops}`), color: '#aabbcc' }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function addGlaze(name: string) {
  const id = newId()
  await db.glazes.add({ id, name, color: '#D8C7A6' })
  return id
}

async function glazes() {
  return {
    tenmoku: await addGlaze('Tenmoku'),
    celadon: await addGlaze('Celadon'),
    oatmeal: await addGlaze('Oatmeal'),
  }
}

function setup() {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const { unmount } = render(<AddCombos onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved, unmount }
}

/** A fired piece wearing these glazes, top first, with a photo on this device. */
async function firedPiece(layers: string[], tag = 'pot') {
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

/** Picks From a piece, then the photo with this caption; resolves to the crop. */
async function fromPiece(caption: string) {
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  await userEvent.click(
    await within(choose).findByRole('button', { name: /From a piece/ }),
  )
  const grid = await screen.findByRole('dialog', { name: 'From a piece' })
  expect(
    within(grid).getByText('Fired pieces with 2 or 3 glazes'),
  ).toBeVisible()
  await userEvent.click(
    await within(grid).findByRole('button', {
      name: `Photo 1, ${caption}`,
    }),
  )
  return screen.findByRole('dialog', { name: 'Crop swatch' })
}

/** Picks the tile photo and the bucket; resolves to the crop screen. */
async function startRun(bucket = 'Tenmoku') {
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  await userEvent.click(
    within(choose).getByRole('button', { name: /Test tile photo/ }),
  )
  fireEvent.change(screen.getByTestId('library-input'), {
    target: { files: [new File(['x'], 'tiles.jpg', { type: 'image/jpeg' })] },
  })
  const sheet = await screen.findByRole('dialog', {
    name: 'Which bucket is this?',
  })
  await userEvent.click(
    await within(sheet).findByRole('button', { name: bucket }),
  )
  return screen.findByRole('dialog', { name: 'Crop swatch' })
}

/** Taps Next on the crop; resolves to the top-glaze sheet. */
async function next() {
  const crop = await screen.findByRole('dialog', { name: 'Crop swatch' })
  await userEvent.click(within(crop).getByRole('button', { name: 'Next' }))
  return screen.findByRole('dialog', { name: 'Which glaze is on top?' })
}

test('a test tile run saves each tile over the bucket', async () => {
  const { tenmoku, celadon, oatmeal } = await glazes()
  const { onClose, onSaved } = setup()
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  expect(
    within(choose).getByText(
      "One bucket's tiles. Crop as many combos as you like.",
    ),
  ).toBeVisible()
  expect(
    within(choose).queryByRole('button', { name: /From a piece/ }),
  ).toBeNull()

  const crop = await startRun()
  expect(within(crop).getByText('Over Tenmoku · 0 saved')).toBeVisible()
  expect(
    within(crop).getByText(
      "Drag and pinch so the square holds only glaze. Read the tile's label before you tap Next.",
    ),
  ).toBeVisible()

  const top = await next()
  expect(within(top).getByText('? over Tenmoku')).toBeVisible()
  expect(
    within(top).getByText('Pick the glaze written on the tile'),
  ).toBeVisible()
  await userEvent.click(within(top).getByRole('button', { name: 'Celadon' }))
  const first = comboId([celadon, tenmoku])
  await waitFor(async () => expect(await db.combos.get(first)).toBeTruthy())
  const back = await screen.findByRole('dialog', { name: 'Crop swatch' })
  expect(within(back).getByText('Over Tenmoku · 1 saved')).toBeVisible()
  expect(
    within(back).getByText(
      'Saved Celadon over Tenmoku. Move the square to the next tile.',
    ),
  ).toBeVisible()

  const second = await next()
  await userEvent.click(within(second).getByRole('button', { name: 'Oatmeal' }))
  const again = await screen.findByText('Over Tenmoku · 2 saved')
  const last = comboId([oatmeal, tenmoku])
  expect(await db.combos.get(last)).toMatchObject({
    layers: [oatmeal, tenmoku],
  })

  await userEvent.click(
    within(again.closest('[role="dialog"]') as HTMLElement).getByRole(
      'button',
      { name: 'Done' },
    ),
  )
  expect(await db.combos.count()).toBe(2)
  expect(onSaved).toHaveBeenCalledTimes(1)
  expect(onSaved).toHaveBeenCalledWith(last)
  expect(onClose).toHaveBeenCalled()
})

test("the bucket's own glaze isn't offered on top", async () => {
  await glazes()
  setup()
  await startRun()
  const top = await next()
  expect(within(top).getByRole('button', { name: 'Celadon' })).toBeVisible()
  expect(within(top).queryByRole('button', { name: /Tenmoku/ })).toBeNull()
})

test('glazes already over this bucket are faded but still replace when picked', async () => {
  const { tenmoku, celadon, oatmeal } = await glazes()
  const old = await storePhoto(photo('old'))
  await db.photos.update(old, { swatch: 1 })
  const id = comboId([oatmeal, tenmoku])
  await db.combos.add({ id, layers: [oatmeal, tenmoku], swatchPhotoId: old })
  // Oatmeal over Celadon is another bucket, so it doesn't fade Oatmeal here.
  await db.combos.add({
    id: comboId([celadon, oatmeal]),
    layers: [celadon, oatmeal],
    swatchPhotoId: old,
  })
  setup()
  await startRun()
  const top = await next()
  const oatTile = await within(top).findByRole('button', { name: /Oatmeal/ })
  await waitFor(() => expect(oatTile).toHaveAttribute('data-saved'))
  expect(
    within(top).getByRole('button', { name: 'Celadon' }),
  ).not.toHaveAttribute('data-saved')
  await userEvent.click(oatTile)
  await screen.findByText('Over Tenmoku · 1 saved')
  const saved = await db.combos.get(id)
  expect(saved?.swatchPhotoId).toBeTruthy()
  expect(saved?.swatchPhotoId).not.toBe(old)
  expect(await db.combos.count()).toBe(2)
})

test('typing a new name adds the glaze', async () => {
  const { tenmoku } = await glazes()
  setup()
  await startRun()
  const top = await next()
  expect(within(top).queryByRole('button', { name: /New glaze/ })).toBeNull()
  await userEvent.type(within(top).getByLabelText('Glaze name'), 'Rutile Blue')
  expect(within(top).queryByRole('button', { name: 'Celadon' })).toBeNull()
  await userEvent.click(within(top).getByRole('button', { name: /New glaze/ }))
  await screen.findByText('Over Tenmoku · 1 saved')
  const added = (await db.glazes.toArray()).find(
    (g) => g.name === 'Rutile Blue',
  )
  expect(added).toMatchObject({ cone: '6', color: DEFAULT_GLAZE_COLOR })
  expect(await db.combos.get(comboId([added?.id ?? '', tenmoku]))).toBeTruthy()
  expect(
    screen.getByText(
      'Saved Rutile Blue over Tenmoku. Move the square to the next tile.',
    ),
  ).toBeVisible()
})

test('a name already in the library offers no New glaze tile', async () => {
  await glazes()
  setup()
  await startRun()
  const top = await next()
  await userEvent.type(within(top).getByLabelText('Glaze name'), ' tenmoku ')
  expect(within(top).queryByRole('button', { name: /New glaze/ })).toBeNull()
})

test('canceling the top-glaze sheet saves nothing and returns to the crop', async () => {
  await glazes()
  setup()
  await startRun()
  const top = await next()
  await userEvent.click(within(top).getByRole('button', { name: 'Cancel' }))
  const crop = await screen.findByRole('dialog', { name: 'Crop swatch' })
  expect(within(crop).getByText('Over Tenmoku · 0 saved')).toBeVisible()
  expect(
    screen.queryByRole('dialog', { name: 'Which glaze is on top?' }),
  ).toBeNull()
  expect(await db.combos.count()).toBe(0)
})

test('a save error shows a toast and stays on the top sheet', async () => {
  await glazes()
  setup()
  await startRun()
  const top = await next()
  vi.spyOn(db.combos, 'put').mockRejectedValue(new Error('full'))
  await userEvent.click(within(top).getByRole('button', { name: 'Celadon' }))
  expect(await screen.findByText(/Couldn't save/)).toBeVisible()
  expect(
    screen.getByRole('dialog', { name: 'Which glaze is on top?' }),
  ).toBeVisible()
  expect(await db.combos.count()).toBe(0)
})

test('Done before any tile saves nothing', async () => {
  await glazes()
  const { onClose, onSaved } = setup()
  const crop = await startRun()
  await userEvent.click(within(crop).getByRole('button', { name: 'Done' }))
  expect(onClose).toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  expect(await db.combos.count()).toBe(0)
})

test('the bucket sheet shows the whole tile photo', async () => {
  await glazes()
  setup()
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  await userEvent.click(
    within(choose).getByRole('button', { name: /Test tile photo/ }),
  )
  fireEvent.change(screen.getByTestId('library-input'), {
    target: { files: [new File(['x'], 'tiles.jpg', { type: 'image/jpeg' })] },
  })
  const sheet = await screen.findByRole('dialog', {
    name: 'Which bucket is this?',
  })
  const shown = await within(sheet).findByRole('img', {
    name: 'Your test tiles',
  })
  expect(shown).toHaveAttribute('src', 'blob:tiles')
  expect(shown).toHaveClass('object-contain')
  expect(
    within(sheet).getByText('The bottom glaze for every tile in this photo'),
  ).toBeVisible()
})

test("from a piece saves the piece's stack", async () => {
  const { tenmoku, celadon } = await glazes()
  await firedPiece([celadon, tenmoku])
  const { onClose, onSaved } = setup()
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  expect(
    await within(choose).findByText(
      'A fired piece with 2 or 3 glazes. One combo.',
    ),
  ).toBeVisible()
  const crop = await fromPiece('Celadon over Tenmoku')
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  const id = comboId([celadon, tenmoku])
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id))
  expect(onClose).toHaveBeenCalled()
  const saved = await db.combos.get(id)
  expect(saved).toMatchObject({ layers: [celadon, tenmoku] })
  expect(saved?.swatchPhotoId).toBeTruthy()
})

test('from a piece asks before replacing an existing combo', async () => {
  const { tenmoku, celadon } = await glazes()
  await firedPiece([celadon, tenmoku])
  const old = await storePhoto(photo('old'))
  await db.photos.update(old, { swatch: 1 })
  const id = comboId([celadon, tenmoku])
  await db.combos.add({ id, layers: [celadon, tenmoku], swatchPhotoId: old })
  const question =
    'Celadon over Tenmoku already has a photo. Replace it with this one?'

  const first = setup()
  let crop = await fromPiece('Celadon over Tenmoku')
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  let ask = await screen.findByRole('dialog', { name: question })
  await userEvent.click(within(ask).getByRole('button', { name: 'Keep old' }))
  expect(first.onClose).toHaveBeenCalled()
  expect(first.onSaved).not.toHaveBeenCalled()
  expect((await db.combos.get(id))?.swatchPhotoId).toBe(old)
  expect((await db.photos.get(old))?.deletedAt).toBeUndefined()
  first.unmount()

  const second = setup()
  crop = await fromPiece('Celadon over Tenmoku')
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  ask = await screen.findByRole('dialog', { name: question })
  await userEvent.click(within(ask).getByRole('button', { name: 'Replace' }))
  await waitFor(() => expect(second.onSaved).toHaveBeenCalledWith(id))
  const saved = await db.combos.get(id)
  expect(saved?.swatchPhotoId).toBeTruthy()
  expect(saved?.swatchPhotoId).not.toBe(old)
  expect((await db.photos.get(old))?.deletedAt).toBeTruthy()
  expect(await db.combos.count()).toBe(1)
})

test('From a piece is hidden when no piece qualifies', async () => {
  const { tenmoku, celadon, oatmeal } = await glazes()
  await firedPiece([celadon], 'one')
  await firedPiece([celadon, tenmoku, oatmeal, celadon], 'four')
  setup()
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  expect(
    within(choose).getByRole('button', { name: /Test tile photo/ }),
  ).toBeVisible()
  expect(
    within(choose).queryByRole('button', { name: /From a piece/ }),
  ).toBeNull()
})

test('a failed save from a piece shows the error and lets you leave', async () => {
  const { tenmoku, celadon } = await glazes()
  await firedPiece([celadon, tenmoku])
  const { onClose, onSaved } = setup()
  const crop = await fromPiece('Celadon over Tenmoku')
  vi.spyOn(db.combos, 'put').mockRejectedValue(new Error('full'))
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  expect(
    await screen.findByText("Couldn't save. Free up space and try again."),
  ).toBeVisible()
  expect(screen.queryByRole('dialog', { name: 'Crop swatch' })).toBeNull()
  const grid = screen.getByRole('dialog', { name: 'From a piece' })
  await userEvent.click(within(grid).getByRole('button', { name: 'Cancel' }))
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  await userEvent.click(within(choose).getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  expect(await db.combos.count()).toBe(0)
})

test('while a piece combo saves, no other photo can be picked', async () => {
  const { tenmoku, celadon } = await glazes()
  await firedPiece([celadon, tenmoku])
  const { onClose, onSaved } = setup()
  const crop = await fromPiece('Celadon over Tenmoku')
  // Hold the save at its first step, the check for an existing combo.
  let release: (value: undefined) => void = () => {}
  const held = new Promise<undefined>((resolve) => {
    release = resolve
  })
  const get = db.combos.get.bind(db.combos)
  vi.spyOn(db.combos, 'get').mockImplementationOnce(() => held as never)
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  // The crop stays up, saving, rather than the grid coming back.
  const saving = screen.getByRole('dialog', { name: 'Crop swatch' })
  await waitFor(() =>
    expect(
      within(saving).getByRole('button', { name: 'Saving…' }),
    ).toBeDisabled(),
  )
  expect(within(saving).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.queryByRole('dialog', { name: 'From a piece' })).toBeNull()
  vi.mocked(db.combos.get).mockImplementation(get)
  release(undefined)
  const id = comboId([celadon, tenmoku])
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(id))
  expect(onClose).toHaveBeenCalled()
  expect(await db.combos.count()).toBe(1)
})
