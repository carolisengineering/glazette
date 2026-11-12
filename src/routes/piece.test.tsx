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
import { type ProcessedImage, processImage } from '../photos/process'
import { setSinkForTests } from '../telemetry/telemetry'
import { renderRoute } from '../test/renderRoute'

// Stored blobs don't survive fake-indexeddb as real Blobs, so expose which photo each image shows.
// Tests call these to say a photo finished loading.
const shown: Array<() => void> = []
vi.mock('../components/PhotoImg', () => ({
  PhotoImg: ({
    photoId,
    alt,
    onShown,
  }: {
    photoId?: string
    alt?: string
    onShown?: () => void
  }) => {
    if (onShown && !shown.includes(onShown)) shown.push(onShown)
    return <img data-photo-id={photoId} alt={alt} />
  },
}))

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))

/** What processImage returns for a picked file. */
const picked: ProcessedImage = {
  blob: new Blob(['new'], { type: 'image/jpeg' }),
  thumb: new Blob(['tnew'], { type: 'image/jpeg' }),
  width: 10,
  height: 10,
  hash: 'hash-new',
  takenAt: '2026-11-04T10:00:00.000Z',
}

beforeEach(async () => {
  shown.length = 0
  await db.delete()
  await db.open()
  await ensureDefaults()
  vi.mocked(processImage).mockReset()
  vi.mocked(processImage).mockResolvedValue(picked)
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setSinkForTests(undefined)
})

function captureEvents() {
  const events: Array<[string, Record<string, unknown>]> = []
  setSinkForTests({
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    captureException: () => {},
  })
  return events
}

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

test('shows caption, each glaze on its own line, and cone from the glaze', async () => {
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
  expect(await screen.findByText('Speckle')).toBeVisible()
  expect(
    within(screen.getByRole('list', { name: 'Glazes' }))
      .getAllByRole('listitem')
      .map((l) => l.textContent),
  ).toEqual(['Oatmeal', 'Speckle'])
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
  const rows = within(
    screen.getByRole('list', { name: 'Journey' }),
  ).getAllByRole('listitem')
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
  const rows = within(
    screen.getByRole('list', { name: 'Journey' }),
  ).getAllByRole('listitem')
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
  expect(
    within(row).getByRole('button', { name: 'Add Trimmed photo' }),
  ).toBeVisible()
  expect(
    within(row).getByRole('button', { name: 'Add Trimmed date' }),
  ).toBeVisible()
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
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
  )
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(
    await within(trimmedRow()).findByRole('button', {
      name: 'Trimmed date, Nov 3',
    }),
  ).toBeVisible()
  expect(screen.queryByLabelText('Trimmed date')).not.toBeInTheDocument()
  const saved = (await db.entries.toArray()).find((e) => e.stage === 'trimmed')
  expect(saved?.date).toBeDefined()
})

test('an empty change event mid-edit does not clear the stored date', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
  )
  const trimmed = async () =>
    (await db.entries.toArray()).find((e) => e.stage === 'trimmed')
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  await waitFor(async () => expect((await trimmed())?.date).toBeDefined())
  const before = (await trimmed())?.date
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '' },
  })
  await new Promise((r) => setTimeout(r, 50))
  expect((await trimmed())?.date).toBe(before)
})

test('Clear date returns the row to Add date', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
  )
  fireEvent.change(screen.getByLabelText('Trimmed date'), {
    target: { value: '2026-11-03' },
  })
  await userEvent.click(
    await screen.findByRole('button', { name: 'Clear date' }),
  )
  expect(
    await within(trimmedRow()).findByRole('button', {
      name: 'Add Trimmed date',
    }),
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
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
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

test('the date editor writes only complete dates, not every keystroke', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
  )
  const update = vi.spyOn(db.entries, 'update')
  const input = screen.getByLabelText('Trimmed date')
  fireEvent.change(input, { target: { value: '0002-11-03' } })
  fireEvent.change(input, { target: { value: '0020-11-03' } })
  fireEvent.change(input, { target: { value: '0202-11-03' } })
  expect(update).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '2026-11-03' } })
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  update.mockRestore()
})

/** firedPiece with a bisque step and photo before the glaze. */
async function journeyPiece() {
  const id = await firedPiece()
  await addStageEntry({
    pieceId: id,
    stage: 'bisqued',
    photo: photo('bisqued'),
    date: '2026-10-15T12:00:00Z',
  })
  return id
}

/** The live step at a stage that has a photo; adding a later step fills in bare ones before it. */
const stepWithPhoto = (pieceId: string, stage: string) =>
  db.entries
    .where('pieceId')
    .equals(pieceId)
    .filter((e) => e.stage === stage && !!e.photoId && !e.deletedAt)
    .first()

const photoOfStage = async (pieceId: string, stage: string) =>
  (await stepWithPhoto(pieceId, stage))?.photoId

const hero = () => screen.getByRole('img', { name: /^Morning Mug/ })

/** The journey's buttons that show a step's photo (the ones with a thumbnail), top to bottom. */
const stepButtons = () => {
  const journey = screen
    .getByRole('heading', { name: 'Journey' })
    .closest('section') as HTMLElement
  return within(journey)
    .getAllByRole('button')
    .filter((b) => b.querySelector('img'))
}

const stepButton = (label: string) => {
  const button = stepButtons().find((b) => b.textContent?.startsWith(label))
  if (!button) throw new Error(`no ${label} photo step`)
  return button
}

test('tapping an earlier step shows its photo and stage at the top, and tapping the latest step goes back', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await waitFor(async () =>
    expect(hero()).toHaveAttribute(
      'data-photo-id',
      await photoOfStage(id, 'fired'),
    ),
  )
  expect(stepButton('Fired')).toHaveAttribute('aria-current', 'true')
  expect(stepButton('Bisqued')).not.toHaveAttribute('aria-current')

  await userEvent.click(stepButton('Bisqued'))
  expect(hero()).toHaveAttribute(
    'data-photo-id',
    await photoOfStage(id, 'bisqued'),
  )
  expect(hero()).toHaveAccessibleName('Morning Mug, Bisqued')
  expect(screen.getByText(/^Bisqued · /)).toBeVisible()
  expect(screen.queryByText(/^Fired · /)).not.toBeInTheDocument()
  expect(stepButton('Bisqued')).toHaveAttribute('aria-current', 'true')
  expect(stepButton('Fired')).not.toHaveAttribute('aria-current')
  expect(
    screen.queryByRole('button', { name: 'Before firing' }),
  ).not.toBeInTheDocument()

  await userEvent.click(stepButton('Fired'))
  expect(hero()).toHaveAttribute(
    'data-photo-id',
    await photoOfStage(id, 'fired'),
  )
  expect(hero()).toHaveAccessibleName('Morning Mug')
  expect(screen.getByText(/^Fired · /)).toBeVisible()
  expect(stepButton('Fired')).toHaveAttribute('aria-current', 'true')
  expect(stepButton('Bisqued')).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('button', { name: 'Before firing' })).toBeVisible()
})

test('tapping a step scrolls back up to the photo', async () => {
  const id = await journeyPiece()
  const scroll = vi.spyOn(window, 'scrollTo')
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  scroll.mockClear()
  await userEvent.click(stepButton('Glazed'))
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
})

test('the latest photo comes back when the shown step is deleted', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  await userEvent.click(stepButton('Bisqued'))
  const bisque = await stepWithPhoto(id, 'bisqued')
  await act(() => softDelete('entries', bisque?.id ?? ''))
  await waitFor(async () =>
    expect(hero()).toHaveAttribute(
      'data-photo-id',
      await photoOfStage(id, 'fired'),
    ),
  )
  expect(screen.getByText(/^Fired · /)).toBeVisible()
})

test('a tap is forgotten once its step becomes the latest, so a new latest step shows', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  await userEvent.click(stepButton('Glazed'))
  const fired = await stepWithPhoto(id, 'fired')
  await act(() => softDelete('entries', fired?.id ?? ''))
  // The header already showed Glazed while it was picked; wait until Glazed is the latest.
  await waitFor(() => expect(hero()).toHaveAccessibleName('Morning Mug'))
  expect(screen.getByText(/^Glazed · /)).toBeVisible()
  await act(() =>
    addStageEntry({
      pieceId: id,
      stage: 'fired',
      photo: photo('refired'),
      date: '2026-11-01T12:00:00Z',
    }),
  )
  await waitFor(async () =>
    expect(hero()).toHaveAttribute(
      'data-photo-id',
      await photoOfStage(id, 'fired'),
    ),
  )
  expect(screen.getByText(/^Fired · /)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Before firing' })).toBeVisible()
})

test('only steps with a photo can be tapped to show it', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  // Thrown, Trimmed and the bare Bisqued step have no photo, so no thumbnail to tap.
  expect(
    stepButtons().map((b) => b.textContent?.match(/^[A-Z][a-z]+/)?.[0]),
  ).toEqual(['Fired', 'Glazed', 'Bisqued'])
})

test('when two steps tie, the top row is the one whose photo is at the top', async () => {
  const id = await createPiece({ name: 'Morning Mug' })
  for (const tag of ['a', 'b', 'c']) {
    await addStageEntry({
      pieceId: id,
      stage: 'bisqued',
      photo: photo(tag),
      date: '2026-10-15T12:00:00Z',
    })
  }
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  await waitFor(() => expect(stepButtons()).toHaveLength(3))
  const [top] = stepButtons()
  expect(top).toHaveAttribute('aria-current', 'true')
  expect(hero()).toHaveAttribute(
    'data-photo-id',
    top.querySelector('img')?.getAttribute('data-photo-id'),
  )
})

test('tapping the latest step shows the latest photo even when the toggle was on before firing', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Morning Mug' })
  await userEvent.click(screen.getByRole('button', { name: 'Before firing' }))
  expect(stepButton('Glazed')).toHaveAttribute('aria-current', 'true')
  await userEvent.click(stepButton('Fired'))
  expect(hero()).toHaveAttribute(
    'data-photo-id',
    await photoOfStage(id, 'fired'),
  )
  expect(
    screen.getByRole('button', { name: 'Out of the kiln' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('deleting a piece reports piece_deleted', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete piece' }),
  )
  const events = captureEvents()
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  )
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(events).toContainEqual(['piece_deleted', {}])
})

test('marking lost reports piece_lost', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  const button = await screen.findByRole('button', { name: 'Mark as lost' })
  const events = captureEvents()
  await userEvent.click(button)
  await waitFor(() =>
    expect(events).toContainEqual(['piece_lost', { lost: true }]),
  )
})

test('a notes save reports piece_edited only when the text changed', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  const notes = await screen.findByRole('textbox', { name: 'Notes' })
  const events = captureEvents()
  await userEvent.click(notes)
  await userEvent.tab()
  expect(events).toEqual([])
  await userEvent.type(notes, 'Thin rim')
  await userEvent.tab()
  await waitFor(() =>
    expect(events).toEqual([['piece_edited', { part: 'notes' }]]),
  )
})

test('reports piece_opened for a piece without a photo', async () => {
  const events = captureEvents()
  const id = await createPiece({ name: 'Bare' })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await waitFor(() =>
    expect(events.filter(([n]) => n === 'piece_opened')).toHaveLength(1),
  )
  const [, props] = events.find(([n]) => n === 'piece_opened') ?? []
  expect(props).toMatchObject({ has_photo: false })
  expect(props?.ms).toEqual(expect.any(Number))
})

test('piece_opened is sent when the hero photo shows within 10 seconds', async () => {
  const events = captureEvents()
  const id = await createPiece({ name: 'Quick', photo: photo('q') })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Quick' })
  await waitFor(() => expect(shown.length).toBeGreaterThan(0))
  act(() => shown[shown.length - 1]())
  expect(events.filter(([n]) => n === 'piece_opened')).toEqual([
    ['piece_opened', { ms: expect.any(Number), has_photo: true }],
  ])
})

test('piece_opened is not sent when the hero photo shows after 10 seconds', async () => {
  const events = captureEvents()
  const id = await createPiece({ name: 'Slow', photo: photo('s') })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Slow' })
  await waitFor(() => expect(shown.length).toBeGreaterThan(0))
  const real = performance.now()
  vi.spyOn(performance, 'now').mockReturnValue(real + 10_001)
  act(() => shown[shown.length - 1]())
  expect(events.filter(([n]) => n === 'piece_opened')).toEqual([])
})

test('piece_opened is not sent when the hero photo never loads', async () => {
  const events = captureEvents()
  const id = await createPiece({ name: 'Stuck', photo: photo('x') })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Stuck' })
  vi.useFakeTimers({ toFake: ['performance'] })
  vi.advanceTimersByTime(15_000)
  expect(events.filter(([n]) => n === 'piece_opened')).toEqual([])
})

/** The screen's own photo input, outside any sheet. */
const screenLibraryInput = () => {
  const inputs = screen
    .getAllByTestId('library-input')
    .filter((i) => !i.closest('[role="dialog"]'))
  expect(inputs).toHaveLength(1)
  return inputs[0] as HTMLInputElement
}

const pickFile = (input: HTMLElement) =>
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'pot.jpg', { type: 'image/jpeg' })] },
  })

const trimmedStep = async () =>
  (await db.entries.toArray()).find((e) => e.stage === 'trimmed')

test('Edit step on the top photo opens the step shown there', async () => {
  const id = await journeyPiece()
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit step' }),
  )
  const fired = screen.getByRole('dialog', { name: 'Fired step' })
  await userEvent.click(within(fired).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await userEvent.click(stepButton('Glazed'))
  await userEvent.click(screen.getByRole('button', { name: 'Edit step' }))
  const glazed = screen.getByRole('dialog', { name: 'Glazed step' })
  expect(
    await within(glazed).findByRole('textbox', { name: 'Glaze 1' }),
  ).toHaveValue('Oatmeal')
})

test('no Edit step button when the piece has no photo', async () => {
  const id = await createPiece({ name: 'Bare' })
  await addStageEntry({ pieceId: id, stage: 'trimmed' })
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  expect(
    screen.queryByRole('button', { name: 'Edit step' }),
  ).not.toBeInTheDocument()
})

test("tapping a photo-less step's name opens its details; Add date still edits inline", async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Trimmed' }),
  )
  const sheet = screen.getByRole('dialog', { name: 'Trimmed step' })
  await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed date' }),
  )
  expect(screen.getByLabelText('Trimmed date')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the empty photo spot adds a photo dated from the photo', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  const input = screenLibraryInput()
  const click = vi.spyOn(input, 'click')
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed photo' }),
  )
  // The picker opens inside the tap, with no sheet first.
  expect(click).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  pickFile(input)
  await waitFor(async () =>
    expect((await trimmedStep())?.photoId).toBeDefined(),
  )
  const step = await trimmedStep()
  expect(step?.date).toBe(picked.takenAt)
  await waitFor(() =>
    expect(trimmedRow().querySelector('img')).toHaveAttribute(
      'data-photo-id',
      step?.photoId,
    ),
  )
})

test('a swap shows Photo changed with Undo, and Undo puts the old photo back', async () => {
  const id = await firedPiece()
  const before = await stepWithPhoto(id, 'fired')
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit step' }),
  )
  const sheet = screen.getByRole('dialog', { name: 'Fired step' })
  pickFile(within(sheet).getByTestId('library-input'))
  const save = within(sheet).getByRole('button', { name: 'Save' })
  await waitFor(() => expect(save).toBeEnabled())
  await userEvent.click(save)

  const toast = await screen.findByText('Photo changed')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const swapped = await db.entries.get(before?.id ?? '')
  expect(swapped?.photoId).not.toBe(before?.photoId)
  await waitFor(() =>
    expect(hero()).toHaveAttribute('data-photo-id', swapped?.photoId),
  )

  await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
  await waitFor(async () =>
    expect((await db.entries.get(before?.id ?? ''))?.photoId).toBe(
      before?.photoId,
    ),
  )
  expect((await db.entries.get(before?.id ?? ''))?.date).toBe(before?.date)
  await waitFor(() =>
    expect(hero()).toHaveAttribute('data-photo-id', before?.photoId),
  )
  expect(screen.queryByText('Photo changed')).not.toBeInTheDocument()
})

test('a save that keeps the photo shows no Undo', async () => {
  const id = await firedPiece()
  renderRoute(`/piece/${id}`)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit step' }),
  )
  const sheet = screen.getByRole('dialog', { name: 'Fired step' })
  await userEvent.type(
    within(sheet).getByRole('textbox', { name: 'Note' }),
    ', thin',
  )
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(screen.queryByText('Photo changed')).not.toBeInTheDocument()
  expect((await stepWithPhoto(id, 'fired'))?.note).toBe(
    'Cone 6 oxidation, thin',
  )
})

test('the step sheet closes when its step goes away', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Trimmed' }),
  )
  expect(screen.getByRole('dialog', { name: 'Trimmed step' })).toBeVisible()
  await act(async () => softDelete('entries', (await trimmedStep())?.id ?? ''))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
})

test('adding a photo reports piece_edited photo', async () => {
  const id = await pieceWithBareTrim()
  renderRoute(`/piece/${id}`)
  await screen.findByRole('heading', { name: 'Bare' })
  const events = captureEvents()
  await userEvent.click(
    within(trimmedRow()).getByRole('button', { name: 'Add Trimmed photo' }),
  )
  pickFile(screenLibraryInput())
  await waitFor(() =>
    expect(events).toContainEqual(['piece_edited', { part: 'photo' }]),
  )
  expect(events.filter(([n]) => n === 'piece_edited')).toHaveLength(1)
})

/** A piece with a Glazed step wearing Celadon. */
async function glazedPiece() {
  const celadon = await addGlaze('Celadon', '6')
  return createPiece({
    name: 'Bowl',
    stage: 'glazed',
    glazes: [{ glazeId: celadon }],
  })
}

const glazeNames = () =>
  within(screen.getByRole('list', { name: 'Glazes' }))
    .getAllByRole('listitem')
    .map((l) => l.textContent)

test('Edit shows glazes only once the piece has a Glazed step', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  let dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  expect(
    within(dialog).queryByRole('textbox', { name: 'Glaze 1' }),
  ).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await addStageEntry({ pieceId: id, stage: 'glazed' })
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  expect(
    await within(dialog).findByRole('textbox', { name: 'Glaze 1' }),
  ).toHaveValue('')
})

test('Edit adds a forgotten glaze and moves it to the bottom layer first', async () => {
  const id = await glazedPiece()
  await addGlaze('Floating Blue', '6')
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  expect(
    await within(dialog).findByRole('textbox', { name: 'Glaze 1' }),
  ).toHaveValue('Celadon')
  await userEvent.click(
    within(dialog).getByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Glaze 2' }),
    'Floating Blue',
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Move glaze 2 up' }),
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  await waitFor(() =>
    expect(glazeNames()).toEqual(['Floating Blue', 'Celadon']),
  )
})

test('a piece logged straight to Fired can get glazes from Edit', async () => {
  const id = await createPiece({ name: 'Cup', stage: 'fired' })
  await addGlaze('Oatmeal', '6')
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  await userEvent.type(
    await within(dialog).findByRole('textbox', { name: 'Glaze 1' }),
    'Oatmeal',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(glazeNames()).toEqual(['Oatmeal']))
})

test('a failed Edit save adds no library glaze', async () => {
  const id = await glazedPiece()
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  await userEvent.click(
    await within(dialog).findByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Glaze 2' }),
    'Brand New',
  )
  const update = vi
    .spyOn(db.pieces, 'update')
    .mockRejectedValue(new Error('full'))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(SAVE_ERROR)).toBeVisible()
  update.mockRestore()
  expect(screen.getByRole('dialog', { name: 'Edit piece' })).toBeVisible()
  expect((await db.glazes.toArray()).map((g) => g.name)).not.toContain(
    'Brand New',
  )
})

test("changing glazes reports piece_edited glazes; leaving them alone doesn't", async () => {
  const id = await glazedPiece()
  const events = captureEvents()
  renderRoute(`/piece/${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  let dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  await within(dialog).findByDisplayValue('Celadon')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  const edited = () => events.filter(([n]) => n === 'piece_edited')
  expect(edited()).toEqual([['piece_edited', { part: 'details' }]])

  events.length = 0
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  dialog = screen.getByRole('dialog', { name: 'Edit piece' })
  await userEvent.click(
    await within(dialog).findByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Glaze 2' }),
    'Speckle',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(edited()).toContainEqual(['piece_edited', { part: 'glazes' }]),
  )
  expect(edited()).toContainEqual(['piece_edited', { part: 'details' }])
})
