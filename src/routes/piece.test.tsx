import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db, newId } from '../db/db'
import {
  addStageEntry,
  createPiece,
  ensureDefaults,
  markLost,
  softDelete,
} from '../db/ops'
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

async function addGlaze(name: string, cone?: string) {
  const id = newId()
  await db.glazes.add({ id, name, cone, color: '#D8C7A6' })
  return id
}

/** A piece that went through glazed and fired, with a photo on each. */
async function firedPiece() {
  const oatmeal = await addGlaze('Oatmeal', '6')
  const id = await createPiece({
    name: 'Morning Mug',
    form: 'mug',
    date: '2026-10-08T12:00:00Z',
  })
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    photo: photo('glazed'),
    date: '2026-10-21T12:00:00Z',
    glazes: [{ glazeId: oatmeal }],
  })
  await addStageEntry({
    pieceId: id,
    stage: 'fired',
    photo: photo('fired'),
    date: '2026-10-25T12:00:00Z',
    note: 'Cone 6 oxidation',
  })
  return id
}

test('before/after toggle is absent until a fired entry exists, then shows both labels', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({ pieceId: id, stage: 'glazed', photo: photo('g') })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Mug' })
  expect(
    screen.queryByRole('button', { name: 'Before firing' }),
  ).not.toBeInTheDocument()
  await addStageEntry({ pieceId: id, stage: 'fired', photo: photo('f') })
  const before = await screen.findByRole('button', { name: 'Before firing' })
  const after = screen.getByRole('button', { name: 'Out of the kiln' })
  expect(after).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(before)
  expect(before).toHaveAttribute('aria-pressed', 'true')
  expect(after).toHaveAttribute('aria-pressed', 'false')
})

test('the toggle swaps the hero between the fired and glazed photos', async () => {
  const id = await firedPiece()
  const photoOf = async (stage: string) =>
    (
      await db.entries
        .where('pieceId')
        .equals(id)
        .filter((e) => e.stage === stage)
        .first()
    )?.photoId
  renderRoute(`/piece/${id}`)
  const hero = () => screen.getByRole('img', { name: 'Morning Mug' })
  await waitFor(async () =>
    expect(hero()).toHaveAttribute('data-photo-id', await photoOf('fired')),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Before firing' }))
  await waitFor(async () =>
    expect(hero()).toHaveAttribute('data-photo-id', await photoOf('glazed')),
  )
})

test('renders when the latest entry has no photo', async () => {
  const id = await createPiece({ name: 'Bare' })
  await addStageEntry({
    pieceId: id,
    stage: 'trimmed',
    date: '2026-10-09T12:00:00Z',
  })
  renderRoute(`/piece/${id}`)
  expect(await screen.findByRole('heading', { name: 'Bare' })).toBeVisible()
  expect(screen.getByText(/^Trimmed ·/)).toBeVisible()
})

test('renders when the piece has no entries at all', async () => {
  const b = newId()
  const now = new Date().toISOString()
  await db.pieces.add({ id: b, name: 'Empty', createdAt: now, updatedAt: now })
  renderRoute(`/piece/${b}`)
  expect(await screen.findByRole('heading', { name: 'Empty' })).toBeVisible()
  expect(screen.getByText('No clay')).toBeVisible()
  expect(screen.getByText('Not glazed yet')).toBeVisible()
})

test('clay card shows "Speckled buff (retired)" when the clay is deleted', async () => {
  const clayId = newId()
  await db.clays.add({ id: clayId, name: 'Speckled buff' })
  const id = await createPiece({ name: 'Mug', clayId })
  renderRoute(`/piece/${id}`)
  expect(await screen.findByText('Speckled buff')).toBeVisible()
  await softDelete('clays', clayId)
  expect(await screen.findByText('Speckled buff (retired)')).toBeVisible()
})

test('shows caption, glaze names joined with plus, and cone from the glaze', async () => {
  const id = await firedPiece()
  const speckle = await addGlaze('Speckle')
  const entry = await db.entries
    .where('pieceId')
    .equals(id)
    .filter((e) => e.stage === 'glazed')
    .first()
  await db.glazeApps.add({
    id: newId(),
    entryId: entry?.id ?? '',
    pieceId: id,
    glazeId: speckle,
    order: 1,
  })
  renderRoute(`/piece/${id}`)
  expect(await screen.findByText('Oatmeal + Speckle')).toBeVisible()
  expect(screen.getByText('Cone 6')).toBeVisible()
  expect(screen.getByText('Fired · Oct 25')).toBeVisible()
})

test('firing falls back to the default cone when no glaze has one', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({ pieceId: id, stage: 'glazed' })
  await db.settings.update('app', { defaultCone: '10' })
  renderRoute(`/piece/${id}`)
  expect(await screen.findByText('Cone 10')).toBeVisible()
})

test('timeline lists entries newest first', async () => {
  const id = await firedPiece()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  const rows = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^Fired.*Cone 6 oxidation.*Oct 25/),
    expect.stringMatching(/^Glazed.*Oct 21/),
    expect.stringMatching(/^Bisqued/),
    expect.stringMatching(/^Trimmed/),
    expect.stringMatching(/^Thrown.*Oct 8/),
  ])
})

test('deleting a timeline entry asks first, then soft-deletes it', async () => {
  const id = await firedPiece()
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete Fired entry' }),
  )
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveAccessibleName(/Delete/)
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const fired = () =>
    db.entries
      .where('pieceId')
      .equals(id)
      .filter((e) => e.stage === 'fired')
      .first()
  expect((await fired())?.deletedAt).toBeUndefined()

  await userEvent.click(
    screen.getByRole('button', { name: 'Delete Fired entry' }),
  )
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  )
  await waitFor(async () => expect((await fired())?.deletedAt).toBeDefined())
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Delete Fired entry' }),
    ).not.toBeInTheDocument(),
  )
  expect(
    screen.queryByRole('button', { name: 'Out of the kiln' }),
  ).not.toBeInTheDocument()
})

test('notes save on blur, only when changed', async () => {
  const id = await createPiece({ name: 'Mug' })
  await db.pieces.update(id, { notes: 'Thin rim' })
  renderRoute(`/piece/${id}`)
  const notes = await screen.findByRole('textbox', { name: 'Notes' })
  expect(notes).toHaveValue('Thin rim')
  const before = (await db.pieces.get(id))?.updatedAt
  await userEvent.click(notes)
  await userEvent.tab()
  expect((await db.pieces.get(id))?.updatedAt).toBe(before)
  await userEvent.type(notes, ' and a lid')
  await userEvent.tab()
  await waitFor(async () =>
    expect((await db.pieces.get(id))?.notes).toBe('Thin rim and a lid'),
  )
})

test('Mark as lost sets piece.lost and toggles back to found', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Mark as lost' }),
  )
  await waitFor(async () => expect((await db.pieces.get(id))?.lost).toBe(true))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Mark as found' }),
  )
  await waitFor(async () => expect((await db.pieces.get(id))?.lost).toBe(false))
})

test('Advance names the next stage and links to capture; hidden when lost or fired', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/piece/${id}`)
  const advance = await screen.findByRole('link', {
    name: 'Move Mug to Trimmed',
  })
  expect(advance).toHaveAttribute('href', `/capture?pieceId=${id}`)
  expect(screen.getByRole('link', { name: 'Add photo' })).toHaveAttribute(
    'href',
    `/capture?pieceId=${id}&addPhoto=true`,
  )
  await markLost(id, true)
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: /^Move Mug/ }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('link', { name: 'Add photo' })).toBeVisible()
  await markLost(id, false)
  await addStageEntry({ pieceId: id, stage: 'fired' })
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: /^Move Mug/ }),
    ).not.toBeInTheDocument(),
  )
  expect(router.state.location.pathname).toBe(`/piece/${id}`)
})

test('Delete asks to confirm, then soft-deletes and returns to the shelf', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete piece' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Delete Mug?' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect((await db.pieces.get(id))?.deletedAt).toBeUndefined()
  await userEvent.click(screen.getByRole('button', { name: 'Delete piece' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  )
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect((await db.pieces.get(id))?.deletedAt).toBeDefined()
})

test('Edit saves name and form, and keeps a retired clay selected', async () => {
  const clayId = newId()
  await db.clays.add({ id: clayId, name: 'Speckled buff' })
  const id = await createPiece({ name: 'Mug', form: 'mug', clayId })
  await softDelete('clays', clayId)
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Mug',
  )
  expect(within(dialog).getByRole('button', { name: 'Mug' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(
    await within(dialog).findByRole('button', {
      name: 'Speckled buff (retired)',
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Tea bowl')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Bowl' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () => {
    const p = await db.pieces.get(id)
    expect(p?.name).toBe('Tea bowl')
    expect(p?.form).toBe('bowl')
  })
  expect((await db.pieces.get(id))?.clayId).toBe(clayId)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Tea bowl' })).toBeVisible()
})

test('shows a message and a way back for a missing or deleted piece', async () => {
  const id = await createPiece({ name: 'Gone' })
  await softDelete('pieces', id)
  renderRoute(`/piece/${id}`)
  expect(
    await screen.findByText("This piece isn't here anymore."),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'Back to shelf' })).toHaveAttribute(
    'href',
    '/',
  )
})

const SAVE_ERROR = "Couldn't save. Free up space and try again."

/** Makes `softDelete` fail: it writes through `db.table(name).update`. */
const failTableWrites = () =>
  vi.spyOn(db, 'table').mockReturnValue({
    update: () => Promise.reject(new Error('full')),
  } as never)

test('a failed notes save shows the toast', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  const notes = await screen.findByRole('textbox', { name: 'Notes' })
  const update = vi
    .spyOn(db.pieces, 'update')
    .mockRejectedValue(new Error('full'))
  await userEvent.type(notes, 'Hello')
  await userEvent.tab()
  expect(await screen.findByText(SAVE_ERROR)).toBeVisible()
  update.mockRestore()
  expect((await db.pieces.get(id))?.notes).toBeUndefined()
})

test('a failed piece delete shows the toast and stays on the piece', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete piece' }),
  )
  const update = failTableWrites()
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  )
  expect(await screen.findByText(SAVE_ERROR)).toBeVisible()
  update.mockRestore()
  expect(router.state.location.pathname).toBe(`/piece/${id}`)
  expect((await db.pieces.get(id))?.deletedAt).toBeUndefined()
})

test('a failed timeline entry delete shows the toast', async () => {
  const id = await firedPiece()
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete Fired entry' }),
  )
  const update = failTableWrites()
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  )
  expect(await screen.findByText(SAVE_ERROR)).toBeVisible()
  update.mockRestore()
})

test('Edit moves focus into the sheet, and Escape closes it and returns focus', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
})

test('Edit with an empty "+ Other" keeps the current clay', async () => {
  const clayId = newId()
  await db.clays.add({ id: clayId, name: 'Porcelain' })
  const id = await createPiece({ name: 'Mug', clayId })
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  await userEvent.click(within(dialog).getByRole('button', { name: '+ Other' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect((await db.pieces.get(id))?.clayId).toBe(clayId)
})

test('the before/after hero uses the newest photo on each side, skipping photo-less entries', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    photo: photo('glazed'),
    date: '2026-10-21T12:00:00Z',
  })
  await addStageEntry({
    pieceId: id,
    stage: 'fired',
    photo: photo('fired'),
    date: '2026-10-24T12:00:00Z',
  })
  await addStageEntry({
    pieceId: id,
    stage: 'fired',
    date: '2026-10-25T12:00:00Z',
  })
  const photoOf = async (stage: string) =>
    (
      await db.entries
        .where('pieceId')
        .equals(id)
        .filter((e) => e.stage === stage && !!e.photoId)
        .first()
    )?.photoId
  renderRoute(`/piece/${id}`)
  const hero = () => screen.getByRole('img', { name: 'Mug' })
  await waitFor(async () =>
    expect(hero()).toHaveAttribute('data-photo-id', await photoOf('fired')),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Before firing' }))
  await waitFor(async () =>
    expect(hero()).toHaveAttribute('data-photo-id', await photoOf('glazed')),
  )
})

test('no before/after toggle when the piece has no Glazed photo', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({ pieceId: id, stage: 'glazed' })
  await addStageEntry({ pieceId: id, stage: 'fired', photo: photo('fired') })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Mug' })
  expect(
    screen.queryByRole('button', { name: 'Before firing' }),
  ).not.toBeInTheDocument()
  const firedPhoto = (
    await db.entries.filter((e) => e.stage === 'fired').first()
  )?.photoId
  expect(screen.getByRole('img', { name: 'Mug' })).toHaveAttribute(
    'data-photo-id',
    firedPhoto,
  )
})

test('the timeline ranks by stage first, like the header: a same-day later Bisqued photo sits below Glazed', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    date: '2026-10-21T09:00:00Z',
  })
  await addStageEntry({
    pieceId: id,
    stage: 'bisqued',
    date: '2026-10-21T15:00:00Z',
  })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Mug' })
  const rows = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^Glazed/),
    expect.stringMatching(/^Bisqued/),
    expect.stringMatching(/^Bisqued/),
    expect.stringMatching(/^Trimmed/),
    expect.stringMatching(/^Thrown/),
  ])
})

test('notes typed but not blurred are saved when the screen is left', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/piece/${id}`)
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Notes' }),
    'Trim the foot',
  )
  await act(() => router.navigate({ to: '/' }))
  await waitFor(async () =>
    expect((await db.pieces.get(id))?.notes).toBe('Trim the foot'),
  )
})

/** A piece with a photo-less, undated Trimmed step between a Thrown and a Bisqued photo. */
async function pieceWithBareTrim() {
  const id = await createPiece({ name: 'Bare', date: '2026-10-20T12:00:00Z' })
  await addStageEntry({
    pieceId: id,
    stage: 'bisqued',
    photo: photo('bisque'),
    date: '2026-11-03T12:00:00Z',
  })
  return id
}

function trimmedRow() {
  const row = screen.getByText('Trimmed').closest('li')
  if (!row) throw new Error('no Trimmed row')
  return row
}

test('a step with no photo is a slim row with Add date and no thumbnail', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  const row = trimmedRow()
  expect(row.querySelector('img')).toBeNull()
  expect(within(row).getByRole('button', { name: 'Add date' })).toBeVisible()
  expect(
    within(row).getByRole('button', { name: 'Delete Trimmed entry' }),
  ).toBeVisible()
  const bisqued = screen.getByText('Bisqued', { selector: 'li span' })
  expect(bisqued.closest('li')?.querySelector('img')).not.toBeNull()
})

test('Add date saves the chosen date and the row shows "Nov 3"', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add date' }),
  )
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(
    await within(trimmedRow()).findByRole('button', { name: 'Nov 3' }),
  ).toBeVisible()
  expect(screen.queryByLabelText('Trimmed date')).not.toBeInTheDocument()
  const saved = (await db.entries.toArray()).find((e) => e.stage === 'trimmed')
  expect(saved?.date).toBeDefined()
})

test('Clear date returns the row to Add date', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add date' }),
  )
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  await userEvent.click(
    await screen.findByRole('button', { name: 'Clear date' }),
  )
  expect(
    await within(trimmedRow()).findByRole('button', { name: 'Add date' }),
  ).toBeVisible()
  const saved = (await db.entries.toArray()).find((e) => e.stage === 'trimmed')
  expect(saved?.date).toBeUndefined()
})

test('header shows only the stage when the current step has no date', async () => {
  const id = await createPiece({ name: 'Bare' })
  await addStageEntry({ pieceId: id, stage: 'trimmed' })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  expect(
    screen.getByText('Trimmed', { selector: 'span.uppercase' }),
  ).toHaveTextContent(/^Trimmed$/)
})

test('Add photo links to capture with addPhoto', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  expect(
    await screen.findByRole('link', { name: 'Add photo' }),
  ).toHaveAttribute('href', `/capture?pieceId=${id}&addPhoto=true`)
})

test('a failed date save shows the toast', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add date' }),
  )
  const update = vi
    .spyOn(db.entries, 'update')
    .mockRejectedValue(new Error('full'))
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  expect(await screen.findByText(SAVE_ERROR)).toBeVisible()
  update.mockRestore()
})
