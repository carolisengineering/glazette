import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { comboId } from '../db/combos'
import { db, newId } from '../db/db'
import { addStageEntry, createPiece, ensureDefaults } from '../db/ops'
import type { ProcessedImage } from '../photos/process'
import { processImage } from '../photos/process'
import { storePhoto } from '../photos/store'
import type { SwatchImage } from '../photos/swatchImage'
import { makeSwatch } from '../photos/swatchImage'
import { track } from '../telemetry/telemetry'
import { renderRoute } from '../test/renderRoute'

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))
vi.mock('../photos/swatchImage', () => ({ makeSwatch: vi.fn() }))
vi.mock('../telemetry/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../telemetry/telemetry')>()),
  track: vi.fn(),
}))

// Stored blobs don't survive fake-indexeddb as real Blobs, so expose which photo each image shows.
vi.mock('../components/PhotoImg', () => ({
  PhotoImg: ({ photoId, alt }: { photoId?: string; alt?: string }) => (
    <img data-photo-id={photoId} alt={alt} />
  ),
}))

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  await db.delete()
  await db.open()
  await ensureDefaults()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function photo(tag: string): ProcessedImage {
  return {
    blob: new Blob([tag], { type: 'image/jpeg' }),
    thumb: new Blob([`t${tag}`], { type: 'image/jpeg' }),
    hash: `hash-${tag}`,
    width: 10,
    height: 10,
    takenAt: new Date().toISOString(),
  }
}

async function addGlaze(
  name: string,
  extra: { cone?: string; notes?: string; color?: string } = {},
) {
  const id = newId()
  await db.glazes.add({ id, name, color: '#D8C7A6', ...extra })
  return id
}

async function glazedPiece(name: string, glazeId: string) {
  const id = await createPiece({ name })
  await addStageEntry({ pieceId: id, stage: 'glazed', glazes: [{ glazeId }] })
  return id
}

test('card copy: "Cone 6 · used on 1 piece" singular and "pieces" plural', async () => {
  const celadon = await addGlaze('Celadon', { cone: '6' })
  const oatmeal = await addGlaze('Oatmeal', { cone: '10' })
  await glazedPiece('Mug', celadon)
  await glazedPiece('Bowl', oatmeal)
  await glazedPiece('Vase', oatmeal)
  renderRoute('/glazes')
  expect(await screen.findByText('Cone 6 · used on 1 piece')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /Oatmeal/ }))
  expect(screen.getByText('Cone 10 · used on 2 pieces')).toBeVisible()
})

test('card omits the cone part when the glaze has none, and says 0 pieces when unused', async () => {
  await addGlaze('Shino')
  renderRoute('/glazes')
  expect(await screen.findByText('used on 0 pieces')).toBeVisible()
})

test('first tile is selected by default, tapping selects, tip shows notes and hides when empty', async () => {
  await addGlaze('Celadon', { notes: 'Glassy on porcelain' })
  await addGlaze('Tenmoku')
  renderRoute('/glazes')
  const celadon = await screen.findByRole('button', { name: /Celadon/ })
  expect(celadon).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Glassy on porcelain')).toBeVisible()
  const tenmoku = screen.getByRole('button', { name: /Tenmoku/ })
  await userEvent.click(tenmoku)
  expect(tenmoku).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByText('Glassy on porcelain')).not.toBeInTheDocument()
})

test('lost pieces are counted, deleted pieces are not', async () => {
  const g = await addGlaze('Celadon', { cone: '6' })
  const lost = await glazedPiece('Lost mug', g)
  await db.pieces.update(lost, { lost: true })
  const gone = await glazedPiece('Gone mug', g)
  await db.pieces.update(gone, { deletedAt: new Date().toISOString() })
  renderRoute('/glazes')
  expect(await screen.findByText('Cone 6 · used on 1 piece')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Lost mug' })).toHaveAttribute(
    'href',
    `/piece/${lost}`,
  )
})

test('swatch tile shows the newest fired photo, and falls back to the color without one', async () => {
  const celadon = await addGlaze('Celadon', { color: '#9DBBAA' })
  const tenmoku = await addGlaze('Tenmoku', { color: '#3A2A20' })
  const mug = await glazedPiece('Mug', celadon)
  await addStageEntry({
    pieceId: mug,
    stage: 'fired',
    photo: photo('fired'),
  })
  await glazedPiece('Plate', tenmoku)
  renderRoute('/glazes')
  const celadonTile = await screen.findByRole('button', { name: /Celadon/ })
  const fired = (await db.entries.toArray()).find((e) => e.stage === 'fired')
  await waitFor(() =>
    expect(
      celadonTile.querySelector(`img[data-photo-id="${fired?.photoId}"]`),
    ).not.toBeNull(),
  )
  const tenmokuTile = screen.getByRole('button', { name: /Tenmoku/ })
  expect(tenmokuTile.querySelector('img')).toBeNull()
  expect(within(tenmokuTile).getByTestId('glaze-swatch')).toHaveStyle({
    backgroundColor: '#3A2A20',
  })
})

test('empty state offers Add glaze', async () => {
  renderRoute('/glazes')
  expect(
    await screen.findByText(
      'No glazes yet. Add one here, or log a Glazed photo.',
    ),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add glaze' })).toBeVisible()
})

test('add glaze sheet saves with cone "6" when left blank', async () => {
  renderRoute('/glazes')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add glaze' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'Add glaze' })
  expect(within(dialog).getByLabelText('Cone')).toHaveAttribute(
    'placeholder',
    '6',
  )
  const save = within(dialog).getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Shino')
  await userEvent.type(within(dialog).getByLabelText('Notes'), 'Thin coat')
  fireEvent.change(within(dialog).getByLabelText('Color'), {
    target: { value: '#c96f4a' },
  })
  await userEvent.click(save)
  await waitFor(async () => {
    const saved = await db.glazes.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'Shino',
      cone: '6',
      color: '#c96f4a',
      notes: 'Thin coat',
    })
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: /Shino/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('a new glaze defaults to the shared swatch color', async () => {
  renderRoute('/glazes')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add glaze' }),
  )
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByLabelText('Color')).toHaveValue('#9dbbaa')
})

test('a name matching another live glaze blocks save', async () => {
  await addGlaze('Celadon')
  renderRoute('/glazes')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add glaze' }),
  )
  const dialog = await screen.findByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Name'), 'celadon')
  expect(within(dialog).getByText('Already in your library')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('editing keeps its own name valid, and saves changes', async () => {
  await addGlaze('Celadon', { cone: '6' })
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit glaze' })
  const name = within(dialog).getByLabelText('Name')
  expect(name).toHaveValue('Celadon')
  expect(within(dialog).queryByText('Already in your library')).toBeNull()
  await userEvent.clear(name)
  await userEvent.type(name, 'Celadon Green')
  await userEvent.clear(within(dialog).getByLabelText('Cone'))
  await userEvent.type(within(dialog).getByLabelText('Cone'), '10')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () => {
    const [g] = await db.glazes.toArray()
    expect(g).toMatchObject({ name: 'Celadon Green', cone: '10' })
  })
  expect(await screen.findByText('Cone 10 · used on 0 pieces')).toBeVisible()
})

test('a failed save shows a toast and keeps the sheet open', async () => {
  vi.spyOn(db.glazes, 'add').mockRejectedValue(new Error('quota'))
  renderRoute('/glazes')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add glaze' }),
  )
  const dialog = await screen.findByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Shino')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText("Couldn't save. Free up space and try again."),
  ).toBeVisible()
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(await db.glazes.count()).toBe(0)
})

test('deleting asks first, removes the glaze from the wall, and pieces show (retired)', async () => {
  const celadon = await addGlaze('Celadon')
  await addGlaze('Tenmoku')
  const mug = await glazedPiece('Mug', celadon)
  const router = renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('dialog', {
    name: /Delete Celadon/,
  })
  // Cancel keeps it.
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect((await db.glazes.toArray()).every((g) => !g.deletedAt)).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const confirm2 = await screen.findByRole('dialog', {
    name: /Delete Celadon/,
  })
  await userEvent.click(
    within(confirm2).getByRole('button', { name: 'Delete' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Celadon/ })).toBeNull(),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: /Tenmoku/ })).toBeVisible()
  await router.navigate({ to: '/piece/$id', params: { id: mug } })
  expect(await screen.findByText('Celadon (retired)')).toBeVisible()
})

test("deleting a glaze with combos says they'll stop showing", async () => {
  const celadon = await addGlaze('Celadon')
  const tenmoku = await addGlaze('Tenmoku')
  const chun = await addGlaze('Chun')
  const ids = ['combo-a', 'combo-b']
  await db.combos.bulkAdd([
    { id: ids[0], layers: [celadon, tenmoku], swatchPhotoId: 'p1' },
    { id: ids[1], layers: [chun, celadon], swatchPhotoId: 'p2' },
  ])
  renderRoute('/glazes')
  await userEvent.click(
    (await screen.findAllByRole('button', { name: 'Edit' }))[0],
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('dialog', { name: /Delete Celadon/ })
  expect(
    within(confirm).getByText(
      "Pieces that used it keep the name, marked (retired). Its 2 combos won't show anymore.",
    ),
  ).toBeVisible()
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(async () =>
    expect((await db.glazes.get(celadon))?.deletedAt).toBeTruthy(),
  )
  for (const id of ids) {
    const row = await db.combos.get(id)
    expect(row).toBeDefined()
    expect(row?.deletedAt).toBeUndefined()
  }
})

test('Escape in the delete confirm closes only the confirm', async () => {
  await addGlaze('Celadon')
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  await screen.findByRole('dialog', { name: /Delete Celadon/ })
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: /Delete Celadon/ })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Edit glaze' })).toBeVisible()
})

test('the add sheet has no Delete button', async () => {
  renderRoute('/glazes')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add glaze' }),
  )
  await screen.findByRole('dialog')
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
})

const swatchImage = (tag: string): SwatchImage => ({
  ...photo(tag),
  color: '#aabbcc',
})

/** Adds a photo through the sheet, crops it, and uses it as the swatch. */
async function cropNewPhoto(dialog: HTMLElement) {
  vi.mocked(processImage).mockResolvedValue(photo('picked'))
  vi.mocked(makeSwatch).mockResolvedValue(swatchImage('crop'))
  fireEvent.change(within(dialog).getByTestId('library-input'), {
    target: { files: [new File(['x'], 'pot.jpg', { type: 'image/jpeg' })] },
  })
  const crop = await screen.findByRole('dialog', { name: 'Crop swatch' })
  await userEvent.click(
    within(crop).getByRole('button', { name: 'Use swatch' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Crop swatch' })).toBeNull(),
  )
}

async function openEdit() {
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.findByRole('dialog', { name: 'Edit glaze' })
}

async function glazeWithSwatch() {
  const id = await addGlaze('Celadon', { color: '#112233' })
  const photoId = await storePhoto(photo('saved'))
  await db.photos.update(photoId, { swatch: 1 })
  await db.glazes.update(id, { swatchPhotoId: photoId })
  return { id, photoId }
}

test('a glaze without a swatch shows No swatch yet, Add photo and the color picker', async () => {
  await addGlaze('Celadon')
  const dialog = await openEdit()
  expect(within(dialog).getByText('Swatch')).toBeVisible()
  expect(within(dialog).getByText('No swatch yet')).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Add photo' }),
  ).toBeVisible()
  expect(within(dialog).getByLabelText('Color')).toBeVisible()
})

test('From a piece is hidden when no piece wearing the glaze has a fired photo', async () => {
  const g = await addGlaze('Celadon')
  await glazedPiece('Mug', g)
  const dialog = await openEdit()
  expect(
    within(dialog).queryByRole('button', { name: 'From a piece' }),
  ).toBeNull()
})

test('From a piece shows when a piece wearing the glaze has a fired photo', async () => {
  const g = await addGlaze('Celadon')
  const mug = await glazedPiece('Mug', g)
  await addStageEntry({ pieceId: mug, stage: 'fired', photo: photo('fired') })
  const dialog = await openEdit()
  expect(
    await within(dialog).findByRole('button', { name: 'From a piece' }),
  ).toBeVisible()
})

test('cropping then Save links the swatch and hides the color picker', async () => {
  const id = await addGlaze('Celadon')
  const dialog = await openEdit()
  await cropNewPhoto(dialog)
  expect(within(dialog).queryByLabelText('Color')).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () =>
    expect((await db.glazes.get(id))?.swatchPhotoId).toBeTruthy(),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const again = await screen.findByRole('dialog', { name: 'Edit glaze' })
  expect(within(again).getByRole('button', { name: 'Replace' })).toBeVisible()
  expect(within(again).getByRole('button', { name: 'Remove' })).toBeVisible()
  expect(within(again).queryByLabelText('Color')).toBeNull()
})

test('cropping then Cancel on the sheet stores nothing', async () => {
  const id = await addGlaze('Celadon')
  const dialog = await openEdit()
  const photos = await db.photos.count()
  const bytes = await db.photoBytes.count()
  await cropNewPhoto(dialog)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await db.photos.count()).toBe(photos)
  expect(await db.photoBytes.count()).toBe(bytes)
  expect((await db.glazes.get(id))?.swatchPhotoId).toBeUndefined()
})

test('Remove then Save clears the swatch and brings the color picker back with the swatch color', async () => {
  const { id } = await glazeWithSwatch()
  const dialog = await openEdit()
  expect(within(dialog).queryByLabelText('Color')).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
  expect(within(dialog).getByLabelText('Color')).toHaveValue('#112233')
  expect(within(dialog).getByText('No swatch yet')).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () =>
    expect((await db.glazes.get(id))?.swatchPhotoId).toBeUndefined(),
  )
})

test('Delete deletes the swatch photo too', async () => {
  const { photoId } = await glazeWithSwatch()
  const dialog = await openEdit()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('dialog', { name: /Delete Celadon/ })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(async () =>
    expect((await db.photos.get(photoId))?.deletedAt).toBeTruthy(),
  )
})

test('Save with a new swatch sends swatch_saved with its source', async () => {
  await addGlaze('Celadon')
  const dialog = await openEdit()
  await cropNewPhoto(dialog)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(track).toHaveBeenCalledWith('swatch_saved', { source: 'photo' }),
  )
})

test('Escape while the crop screen is open leaves the sheet open', async () => {
  await addGlaze('Celadon')
  const dialog = await openEdit()
  vi.mocked(processImage).mockResolvedValue(photo('picked'))
  fireEvent.change(within(dialog).getByTestId('library-input'), {
    target: { files: [new File(['x'], 'pot.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('dialog', { name: 'Crop swatch' })
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Crop swatch' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Edit glaze' })).toBeVisible()
})

async function addCombo(layers: string[]) {
  const id = comboId(layers)
  await db.combos.add({ id, layers, swatchPhotoId: `swatch-${id}` })
  return id
}

async function comboPiece(name: string, layers: string[]) {
  const id = await createPiece({ name })
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    glazes: layers.map((glazeId) => ({ glazeId })),
  })
  return id
}

async function comboSetup() {
  const tenmoku = await addGlaze('Tenmoku')
  const celadon = await addGlaze('Celadon')
  const oatmeal = await addGlaze('Oatmeal')
  await addCombo([oatmeal, tenmoku])
  await addCombo([celadon, tenmoku])
  await addCombo([oatmeal, celadon])
  return { tenmoku, celadon, oatmeal }
}

test('the switch shows combos grouped by bucket', async () => {
  await comboSetup()
  renderRoute('/glazes')
  const combosTab = await screen.findByRole('button', { name: 'Combos' })
  expect(combosTab).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: 'Glazes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await userEvent.click(combosTab)
  expect(combosTab).toHaveAttribute('aria-pressed', 'true')
  const headings = await screen.findAllByRole('heading', { name: /^Over / })
  expect(headings.map((h) => h.textContent)).toEqual([
    'Over Celadon',
    'Over Tenmoku',
  ])
  expect(
    screen.getByRole('button', { name: 'Oatmeal over Celadon' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Celadon over Tenmoku' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Oatmeal over Tenmoku' }),
  ).toBeVisible()
})

test('the header button says Add combos on the Combos side', async () => {
  await comboSetup()
  renderRoute('/glazes')
  expect(await screen.findByRole('button', { name: 'Add glaze' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Combos' }))
  expect(screen.getByRole('button', { name: 'Add combos' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Add glaze' })).toBeNull()
})

test('tapping a combo shows its card with the pieces that wore it', async () => {
  const { tenmoku, celadon, oatmeal } = await comboSetup()
  const mug = await comboPiece('Mug', [celadon, tenmoku])
  await comboPiece('Bowl', [oatmeal, tenmoku])
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Combos' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Celadon over Tenmoku' }),
  )
  const card = screen.getByRole('region', { name: 'Celadon over Tenmoku' })
  expect(within(card).getByText('used on 1 piece')).toBeVisible()
  expect(within(card).getByRole('link', { name: 'Mug' })).toHaveAttribute(
    'href',
    `/piece/${mug}`,
  )
  expect(within(card).queryByRole('link', { name: 'Bowl' })).toBeNull()
  expect(within(card).getByRole('button', { name: 'Edit' })).toBeVisible()
})

test("a combo's Edit opens its sheet, and deleting falls back to the first combo", async () => {
  await comboSetup()
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Combos' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Celadon over Tenmoku' }),
  )
  const card = screen.getByRole('region', { name: 'Celadon over Tenmoku' })
  await userEvent.click(within(card).getByRole('button', { name: 'Edit' }))
  const sheet = await screen.findByRole('dialog', { name: 'Edit combo' })
  await userEvent.click(
    within(sheet).getByRole('button', { name: 'Delete combo' }),
  )
  await userEvent.click(
    within(
      screen.getByRole('dialog', { name: 'Delete Celadon over Tenmoku?' }),
    ).getByRole('button', { name: 'Delete' }),
  )
  expect(
    await screen.findByRole('region', { name: 'Oatmeal over Celadon' }),
  ).toBeVisible()
  expect(screen.queryByRole('dialog', { name: 'Edit combo' })).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Celadon over Tenmoku' }),
  ).toBeNull()
})

test('no combos yet shows the empty message', async () => {
  await addGlaze('Celadon')
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Combos' }))
  expect(
    await screen.findByText(
      "No combos yet. Add them from a photo of your studio's test tiles, or from a fired piece.",
    ),
  ).toBeVisible()
  expect(screen.getAllByRole('button', { name: 'Add combos' })).toHaveLength(1)
})

test('Add combos runs the test tile flow and selects the last combo saved', async () => {
  const { tenmoku } = await comboSetup()
  const shino = await addGlaze('Shino')
  vi.mocked(processImage).mockResolvedValue(photo('tiles'))
  vi.mocked(makeSwatch).mockResolvedValue(swatchImage('tile'))
  renderRoute('/glazes')
  await userEvent.click(await screen.findByRole('button', { name: 'Combos' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add combos' }))
  const choose = await screen.findByRole('dialog', { name: 'Add combos' })
  await userEvent.click(
    within(choose).getByRole('button', { name: /Test tile photo/ }),
  )
  fireEvent.change(screen.getByTestId('library-input'), {
    target: { files: [new File(['x'], 'tiles.jpg', { type: 'image/jpeg' })] },
  })
  const bucket = await screen.findByRole('dialog', {
    name: 'Which bucket is this?',
  })
  await userEvent.click(within(bucket).getByRole('button', { name: 'Tenmoku' }))
  const crop = await screen.findByRole('dialog', { name: 'Crop swatch' })
  await userEvent.click(within(crop).getByRole('button', { name: 'Next' }))
  const top = await screen.findByRole('dialog', {
    name: 'Which glaze is on top?',
  })
  // Celadon is already over Tenmoku in the setup, so it shows as saved.
  expect(within(top).getByRole('button', { name: /Celadon/ })).toHaveAttribute(
    'data-saved',
  )
  await userEvent.click(within(top).getByRole('button', { name: 'Shino' }))
  await screen.findByText('Over Tenmoku · 1 saved')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(
    await screen.findByRole('region', { name: 'Shino over Tenmoku' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Shino over Tenmoku' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await db.combos.get(comboId([shino, tenmoku]))).toBeTruthy()
})

test('the Glazes and Combos switch buttons are full tap height', async () => {
  await addGlaze('Celadon')
  renderRoute('/glazes')
  for (const name of ['Glazes', 'Combos']) {
    expect(await screen.findByRole('button', { name })).toHaveClass('h-11')
  }
})

test('the Glazes side is unchanged with the switch present', async () => {
  await addGlaze('Celadon', { cone: '6' })
  renderRoute('/glazes')
  expect(await screen.findByText('Cone 6 · used on 0 pieces')).toBeVisible()
  expect(screen.getByRole('button', { name: /Celadon/ })).toBeVisible()
})

test('no switch before any glaze exists', async () => {
  renderRoute('/glazes')
  await screen.findByText(/No glazes yet/)
  expect(screen.queryByRole('button', { name: 'Combos' })).toBeNull()
})
