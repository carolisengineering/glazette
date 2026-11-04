import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import {
  addStageEntry,
  createPiece,
  ensureDefaults,
  markLost,
  softDelete,
  upsertClay,
  upsertGlaze,
} from '../db/ops'
import { type ProcessedImage, processImage } from '../photos/process'
import { renderRoute } from '../test/renderRoute'
import { PickPieceSheet } from './PickPieceSheet'
import { useCaptureStore } from './store'

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

async function seed(name: string, updatedAt: string, clayName?: string) {
  const clayId = clayName ? await upsertClay(clayName) : undefined
  const id = await createPiece({ name, clayId })
  await db.pieces.update(id, { updatedAt })
  return id
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

/** Names shown in the pick list, top to bottom. */
function listed() {
  const list = screen.getByTestId('pick-list')
  return within(list)
    .queryAllByRole('button', { pressed: true })
    .concat(within(list).queryAllByRole('button', { pressed: false }))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map((b) => b.getAttribute('data-piece'))
}

test('pick sheet lists only in-progress pieces, newest first, and filters by search', async () => {
  await seed('Old Mug', '2026-10-01T00:00:00.000Z', 'Porcelain')
  await seed('New Bowl', '2026-10-20T00:00:00.000Z')
  const fired = await seed('Done Vase', '2026-10-25T00:00:00.000Z')
  await addStageEntry({ pieceId: fired, stage: 'fired' })
  await db.pieces.update(fired, { updatedAt: '2026-10-25T00:00:00.000Z' })
  const lost = await seed('Lost Jar', '2026-10-26T00:00:00.000Z')
  await markLost(lost, true)
  const deleted = await seed('Gone Plate', '2026-10-27T00:00:00.000Z')
  await softDelete('pieces', deleted)

  const onPick = vi.fn()
  render(<PickPieceSheet onPick={onPick} onNew={vi.fn()} />)

  await screen.findByText('New Bowl')
  expect(listed()).toEqual(['New Bowl', 'Old Mug'])
  expect(screen.getByText('Which piece is this?')).toBeVisible()
  expect(screen.getByText('Showing pieces still in progress')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add to New Bowl' })).toBeVisible()

  // Search by clay name, case-insensitive; selection moves to first visible.
  await userEvent.type(screen.getByPlaceholderText('Search pieces'), 'PORCE')
  expect(listed()).toEqual(['Old Mug'])
  await userEvent.click(screen.getByRole('button', { name: 'Add to Old Mug' }))
  const oldMug = await db.pieces.filter((p) => p.name === 'Old Mug').first()
  expect(onPick).toHaveBeenCalledWith(oldMug?.id)
})

test('search matches glaze names', async () => {
  const id = await seed('Tall Vase', '2026-10-01T00:00:00.000Z')
  await seed('Other', '2026-10-02T00:00:00.000Z')
  const glazeId = await upsertGlaze({ name: 'Celadon', color: '#9DBBAA' })
  await addStageEntry({ pieceId: id, stage: 'glazed', glazes: [{ glazeId }] })
  await db.pieces.update(id, { updatedAt: '2026-10-01T00:00:00.000Z' })
  render(<PickPieceSheet onPick={vi.fn()} onNew={vi.fn()} />)
  await screen.findByText('Other')
  await userEvent.type(screen.getByPlaceholderText('Search pieces'), 'celad')
  expect(listed()).toEqual(['Tall Vase'])
})

test('tapping a row changes the selection and Not here calls onNew; no rows means no add button', async () => {
  await seed('A', '2026-10-01T00:00:00.000Z')
  await seed('B', '2026-10-02T00:00:00.000Z')
  const onNew = vi.fn()
  render(<PickPieceSheet onPick={vi.fn()} onNew={onNew} />)
  await screen.findByText('B')
  await userEvent.click(within(screen.getByTestId('pick-list')).getByText('A'))
  expect(screen.getByRole('button', { name: 'Add to A' })).toBeVisible()
  await userEvent.type(screen.getByPlaceholderText('Search pieces'), 'zzz')
  expect(screen.queryByRole('button', { name: /^Add to/ })).toBeNull()
  await userEvent.click(
    screen.getByRole('button', { name: 'Not here? Save as a new piece' }),
  )
  expect(onNew).toHaveBeenCalled()
})

async function useUpdatePhoto() {
  await userEvent.upload(
    await screen.findByTestId('capture-input'),
    new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Use photo' }),
  )
}

test('in Update mode, Use photo opens the pick sheet; picking leads to the stage strip and Change returns', async () => {
  await seed('Mug', '2026-10-01T00:00:00.000Z')
  renderRoute('/capture')
  await useUpdatePhoto()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add to Mug' }),
  )
  await screen.findByRole('button', { name: 'Save to Trimmed' })
  await userEvent.click(screen.getByRole('button', { name: 'Change' }))
  await screen.findByText('Which piece is this?')
})

test('Retake on the pick sheet clears the photo and reopens the camera', async () => {
  await seed('Mug', '2026-10-01T00:00:00.000Z')
  renderRoute('/capture')
  await useUpdatePhoto()
  await screen.findByText('Which piece is this?')
  const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
  await userEvent.click(screen.getByRole('button', { name: 'Retake' }))
  expect(clickSpy).toHaveBeenCalled()
  expect(useCaptureStore.getState().photo).toBeUndefined()
  clickSpy.mockRestore()
})

test('Not here? creates a Thrown piece with the photo and opens the details sheet', async () => {
  await seed('Mug', '2026-10-01T00:00:00.000Z')
  renderRoute('/capture')
  await useUpdatePhoto()
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Not here? Save as a new piece',
    }),
  )
  await screen.findByText('Saved to your shelf as Thrown')
  await waitFor(async () => expect(await db.pieces.count()).toBe(2))
})
