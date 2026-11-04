import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db, newId } from '../db/db'
import { addStageEntry, createPiece, ensureDefaults } from '../db/ops'
import type { ProcessedImage } from '../photos/process'
import { renderRoute } from '../test/renderRoute'

// Stored blobs don't survive fake-indexeddb as real Blobs, so expose which photo each image shows.
vi.mock('../components/PhotoImg', () => ({
  PhotoImg: ({ photoId, alt }: { photoId?: string; alt?: string }) => (
    <img data-photo-id={photoId} alt={alt} />
  ),
}))

beforeEach(async () => {
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
  expect(within(tenmokuTile).getByTestId('swatch-fill')).toHaveStyle({
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
