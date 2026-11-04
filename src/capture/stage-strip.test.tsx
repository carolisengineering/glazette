import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import * as ops from '../db/ops'
import { type ProcessedImage, processImage } from '../photos/process'
import { renderRoute } from '../test/renderRoute'
import { useCaptureStore } from './store'

const { addStageEntry, createPiece, ensureDefaults, upsertGlaze } = ops

vi.mock('../photos/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photos/process')>()),
  processImage: vi.fn(),
}))

const processed: ProcessedImage = {
  blob: new Blob(['full'], { type: 'image/jpeg' }),
  thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  width: 800,
  height: 600,
  hash: 'hash-1',
  takenAt: '2026-10-30T09:00:00.000Z',
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
  useCaptureStore.getState().reset()
  vi.mocked(processImage).mockReset()
  vi.mocked(processImage).mockResolvedValue(processed)
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function openStrip(pieceId: string) {
  const router = renderRoute(`/capture?pieceId=${pieceId}`)
  await userEvent.upload(
    await screen.findByTestId('capture-input'),
    new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Use photo' }),
  )
  return router
}

const stageBtn = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) })

test('stage strip preselects Trimmed for a Thrown piece and disables earlier stages', async () => {
  const id = await createPiece({ name: 'Mug' })
  await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  expect(stageBtn('Trimmed')).toHaveAttribute('aria-pressed', 'true')
  expect(stageBtn('Thrown')).toBeEnabled()
  expect(stageBtn('Bisqued')).toBeEnabled()
  expect(stageBtn('Fired')).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
})

test('earlier stages are disabled once a piece has moved on', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({ pieceId: id, stage: 'trimmed' })
  await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Bisqued' })
  expect(stageBtn('Thrown')).toBeDisabled()
  expect(stageBtn('Trimmed')).toBeEnabled()
})

test('the current stage is selectable and labels the button Save photo', async () => {
  const id = await createPiece({ name: 'Mug' })
  await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  await userEvent.click(stageBtn('Thrown'))
  expect(screen.getByRole('button', { name: 'Save photo' })).toBeVisible()
})

test('a fired piece allows only Fired', async () => {
  const id = await createPiece({ name: 'Mug' })
  await addStageEntry({ pieceId: id, stage: 'fired' })
  await openStrip(id)
  await screen.findByRole('button', { name: 'Save photo' })
  expect(stageBtn('Fired')).toHaveAttribute('aria-pressed', 'true')
  for (const s of ['Thrown', 'Trimmed', 'Bisqued', 'Glazed']) {
    expect(stageBtn(s)).toBeDisabled()
  }
})

test('Bisqued note is prefilled with "Cone 6" and a user-edited note survives stage changes', async () => {
  const id = await createPiece({ name: 'Mug' })
  await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  const note = screen.getByLabelText('Note · optional')
  expect(note).toHaveValue('')
  expect(note).toHaveAttribute('placeholder', 'Handle attached, foot trimmed')
  await userEvent.click(stageBtn('Bisqued'))
  expect(note).toHaveValue('Cone 6')
  await userEvent.click(stageBtn('Fired'))
  expect(note).toHaveValue('Cone 6 oxidation')
  await userEvent.clear(note)
  await userEvent.type(note, 'my note')
  await userEvent.click(stageBtn('Bisqued'))
  expect(note).toHaveValue('my note')
})

test('saving writes the entry with the photo, resets the store and opens the piece', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = await openStrip(id)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save to Trimmed' }),
  )
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )
  const entries = await db.entries.where('pieceId').equals(id).toArray()
  const trimmed = entries.find((e) => e.stage === 'trimmed')
  expect(trimmed?.photoId).toBeTruthy()
  expect(trimmed?.note).toBeUndefined()
  expect(trimmed?.date).toBe(processed.takenAt)
  expect(useCaptureStore.getState().photo).toBeUndefined()
})

test('selecting Glazed shows glaze rows; saving writes the GlazeApplications in order', async () => {
  const id = await createPiece({ name: 'Mug' })
  const celadon = await upsertGlaze({ name: 'Celadon', color: '#9DBBAA' })
  const router = await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  expect(screen.queryByLabelText('Glaze 1')).toBeNull()
  await userEvent.click(stageBtn('Glazed'))
  await userEvent.click(screen.getByRole('button', { name: 'Celadon' }))
  await userEvent.type(screen.getByLabelText('Dips for glaze 1'), '2')
  await userEvent.selectOptions(
    screen.getByLabelText('Method for glaze 1'),
    'dip',
  )
  await userEvent.click(
    screen.getByRole('button', { name: '+ add another glaze' }),
  )
  // Typing a library name in a different case reuses it.
  await userEvent.type(screen.getByLabelText('Glaze 2'), '  celadon ')
  await userEvent.type(screen.getByLabelText('Note for glaze 2'), 'thin')
  // A blank row is skipped.
  await userEvent.click(
    screen.getByRole('button', { name: '+ add another glaze' }),
  )
  // The same brand-new glaze named twice is created once.
  await userEvent.click(
    screen.getByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(screen.getByLabelText('Glaze 4'), 'Tenmoku')
  await userEvent.click(
    screen.getByRole('button', { name: '+ add another glaze' }),
  )
  await userEvent.type(screen.getByLabelText('Glaze 5'), 'tenmoku')
  await userEvent.click(screen.getByRole('button', { name: 'Save to Glazed' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )

  const glazes = await db.glazes.toArray()
  expect(glazes.map((g) => g.name).sort()).toEqual(['Celadon', 'Tenmoku'])
  const tenmoku = glazes.find((g) => g.name === 'Tenmoku')
  expect(tenmoku?.cone).toBe('6')
  expect(tenmoku?.color).toBe('#9DBBAA')
  const apps = (await db.glazeApps.toArray()).sort((a, b) => a.order - b.order)
  expect(apps.map((a) => a.glazeId)).toEqual([
    celadon,
    celadon,
    tenmoku?.id,
    tenmoku?.id,
  ])
  expect(apps[0]).toMatchObject({ dips: 2, method: 'dip' })
  expect(apps[1].note).toBe('thin')
})

test('a typed name matching an existing glaze case-insensitively reuses it', async () => {
  const id = await createPiece({ name: 'Mug' })
  const celadon = await upsertGlaze({ name: 'Celadon', color: '#9DBBAA' })
  const router = await openStrip(id)
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  await userEvent.click(stageBtn('Glazed'))
  await userEvent.type(screen.getByLabelText('Glaze 1'), 'CELADON')
  await userEvent.click(screen.getByRole('button', { name: 'Save to Glazed' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )
  expect(await db.glazes.count()).toBe(1)
  expect((await db.glazeApps.toArray())[0].glazeId).toBe(celadon)
})

test('save failure shows the toast and does not navigate', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = await openStrip(id)
  vi.spyOn(ops, 'addStageEntry').mockRejectedValueOnce(new Error('quota'))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save to Trimmed' }),
  )
  expect(
    await screen.findByText("Couldn't save. Free up space and try again."),
  ).toBeVisible()
  expect(router.state.location.pathname).toBe('/capture')
  expect(screen.getByRole('button', { name: 'Save to Trimmed' })).toBeEnabled()
  expect(useCaptureStore.getState().photo).toBeDefined()
})
