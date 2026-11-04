import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import * as ops from '../db/ops'
import { createPiece, ensureDefaults, softDelete } from '../db/ops'
import {
  type ProcessedImage,
  processImage,
  UnsupportedImageError,
} from '../photos/process'
import { renderRoute } from '../test/renderRoute'
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

const file = () => new File(['x'], 'pot.jpg', { type: 'image/jpeg' })

let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
  useCaptureStore.getState().reset()
  vi.mocked(processImage).mockReset()
  vi.mocked(processImage).mockResolvedValue(processed)
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
  clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
})

afterEach(() => {
  clickSpy.mockRestore()
})

async function chooseFile() {
  const input = await screen.findByTestId('capture-input')
  await userEvent.upload(input, file())
}

async function submitAsNewPiece() {
  await chooseFile()
  await userEvent.click(
    await screen.findByRole('button', { name: 'New piece' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
}

test('opens the camera input on mount and offers Take photo and Choose from library', async () => {
  renderRoute('/capture')
  expect(
    await screen.findByRole('button', { name: 'Take photo' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Choose from library' }),
  ).toBeVisible()
  expect(clickSpy).toHaveBeenCalledTimes(1)
  const input = screen.getByTestId('capture-input')
  expect(input).toHaveAttribute('capture', 'environment')
  expect(input).toHaveAttribute('accept', 'image/*')
  expect(screen.getByTestId('library-input')).not.toHaveAttribute('capture')
})

test('Use photo in New mode creates a piece at Thrown with the photo and opens the details sheet', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const pieces = await db.pieces.toArray()
  expect(pieces).toHaveLength(1)
  const settings = await db.settings.get('app')
  expect(pieces[0].clayId).toBe(settings?.defaultClayId)
  expect(pieces[0].createdAt).toBe(processed.takenAt)
  const entries = await db.entries.toArray()
  expect(entries).toHaveLength(1)
  expect(entries[0].stage).toBe('thrown')
  expect(entries[0].photoId).toBeTruthy()
  expect(await db.photos.count()).toBe(1)
  expect(screen.getByPlaceholderText('Name it later')).toBeVisible()
  expect(
    await screen.findByRole('button', { name: 'White stoneware' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('nothing is saved before Use photo', async () => {
  renderRoute('/capture')
  await chooseFile()
  await screen.findByRole('button', { name: 'Use photo' })
  expect(await db.pieces.count()).toBe(0)
  expect(await db.photos.count()).toBe(0)
})

test('details sheet Done with name "Morning Mug" and form Mug updates the piece and returns to the shelf', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.type(
    await screen.findByPlaceholderText('Name it later'),
    '  Morning Mug ',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Mug' }))
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const [piece] = await db.pieces.toArray()
  expect(piece.name).toBe('Morning Mug')
  expect(piece.form).toBe('mug')
  expect(useCaptureStore.getState().photo).toBeUndefined()
})

test('Done with nothing filled in leaves name and form unset', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: 'Done' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const [piece] = await db.pieces.toArray()
  expect(piece.name).toBeUndefined()
  expect(piece.form).toBeUndefined()
})

test('a failed Done shows a toast, stays on the sheet and can be retried', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  const spy = vi
    .spyOn(ops, 'updatePiece')
    .mockRejectedValueOnce(new Error('quota'))
  try {
    const done = await screen.findByRole('button', { name: 'Done' })
    await userEvent.click(done)
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Couldn't save. Free up space and try again.",
    )
    expect(router.state.location.pathname).toBe('/capture')
    await waitFor(() => expect(done).toBeEnabled())
    await userEvent.click(done)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  } finally {
    spy.mockRestore()
  }
})

test('Other clay creates a clay and assigns it on Done', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: '+ Other' }))
  await userEvent.type(screen.getByLabelText('Clay name'), 'Speckled buff')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const clay = await db.clays.filter((c) => c.name === 'Speckled buff').first()
  expect(clay).toBeTruthy()
  const [piece] = await db.pieces.toArray()
  expect(piece.clayId).toBe(clay?.id)
})

test('clay chips list recently used clays first, then unused ones alphabetically, and hide deleted ones', async () => {
  await db.clays.bulkAdd([
    { id: 'c-z', name: 'Zed clay' },
    { id: 'c-a', name: 'Alpha clay' },
    { id: 'c-used', name: 'Used clay' },
    { id: 'c-gone', name: 'Gone clay' },
  ])
  await createPiece({ clayId: 'c-used' })
  await softDelete('clays', 'c-gone')
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByRole('button', { name: 'Zed clay' })
  const names = [
    'White stoneware',
    'Used clay',
    'Alpha clay',
    'Zed clay',
    'Gone clay',
  ]
  const labels = screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => names.includes(t))
  // The new piece uses the default clay, so it is the most recently used.
  expect(labels).toEqual([
    'White stoneware',
    'Used clay',
    'Alpha clay',
    'Zed clay',
  ])
})

test('Retake clears the photo and reopens the file input', async () => {
  renderRoute('/capture')
  await chooseFile()
  const retake = await screen.findByRole('button', { name: 'Retake' })
  clickSpy.mockClear()
  await userEvent.click(retake)
  expect(useCaptureStore.getState().photo).toBeUndefined()
  expect(
    await screen.findByRole('button', { name: 'Take photo' }),
  ).toBeVisible()
  expect(clickSpy).toHaveBeenCalledTimes(1)
  expect(clickSpy.mock.contexts[0]).toBe(screen.getByTestId('capture-input'))
})

test('unsupported image shows "This photo format isn\'t supported" and keeps the capture buttons', async () => {
  vi.mocked(processImage).mockRejectedValue(new UnsupportedImageError())
  renderRoute('/capture')
  await chooseFile()
  expect(
    await screen.findByText("This photo format isn't supported"),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Choose from library' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Use photo' }),
  ).not.toBeInTheDocument()
})

test('any other processing error shows a generic message', async () => {
  vi.mocked(processImage).mockRejectedValue(new Error('boom'))
  renderRoute('/capture')
  await chooseFile()
  expect(
    await screen.findByText("Couldn't open this photo. Try again."),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible()
})

test('a createPiece failure shows a toast and stays on review', async () => {
  const spy = vi.spyOn(db.pieces, 'add').mockRejectedValue(new Error('quota'))
  try {
    renderRoute('/capture')
    await submitAsNewPiece()
    expect(
      await screen.findByText("Couldn't save. Free up space and try again."),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Use photo' })).toBeVisible()
    expect(
      screen.queryByText('Saved to your shelf as Thrown'),
    ).not.toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

test('with a pieceId the toggle is hidden and Use photo creates no piece', async () => {
  renderRoute('/capture?pieceId=abc')
  await chooseFile()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Use photo' }),
  )
  expect(
    screen.queryByRole('button', { name: 'New piece' }),
  ).not.toBeInTheDocument()
  expect(await db.pieces.count()).toBe(0)
})

test('leaving the screen resets the store', async () => {
  const router = renderRoute('/capture')
  await chooseFile()
  await screen.findByRole('button', { name: 'Use photo' })
  await act(() => router.navigate({ to: '/' }))
  expect(useCaptureStore.getState().photo).toBeUndefined()
})

test('a photo that finishes processing after leaving capture is dropped', async () => {
  let resolve: (p: ProcessedImage) => void = () => {}
  vi.mocked(processImage).mockReturnValue(
    new Promise<ProcessedImage>((r) => {
      resolve = r
    }),
  )
  const router = renderRoute('/capture')
  await chooseFile()
  await act(() => router.navigate({ to: '/' }))
  await act(async () => resolve(processed))
  expect(useCaptureStore.getState().photo).toBeUndefined()
  await act(() => router.navigate({ to: '/capture' }))
  expect(
    await screen.findByRole('button', { name: 'Take photo' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Use photo' }),
  ).not.toBeInTheDocument()
})

test('Done on the new-piece sheet replaces the capture entry, so Back does not return to it', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: 'Done' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  act(() => router.history.back())
  await new Promise((r) => setTimeout(r, 50))
  expect(router.state.location.pathname).not.toBe('/capture')
})

test('a retired default clay is not assigned to a new piece', async () => {
  const settings = await db.settings.get('app')
  await softDelete('clays', settings?.defaultClayId as string)
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const [piece] = await db.pieces.toArray()
  expect(piece.clayId).toBeUndefined()
})

test('a live default clay is still assigned to a new piece', async () => {
  const settings = await db.settings.get('app')
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const [piece] = await db.pieces.toArray()
  expect(piece.clayId).toBe(settings?.defaultClayId)
})

test('a repeat failure with the same message restarts the toast timer', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout')
  const spy = vi.spyOn(db.pieces, 'add').mockRejectedValue(new Error('quota'))
  const toastTimers = () =>
    timers.mock.calls.filter(([, ms]) => ms === 4000).length
  try {
    renderRoute('/capture')
    await submitAsNewPiece()
    await screen.findByText("Couldn't save. Free up space and try again.")
    expect(toastTimers()).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
    await waitFor(() => expect(toastTimers()).toBe(2))
  } finally {
    spy.mockRestore()
    timers.mockRestore()
  }
})

test('Done does not write a retired default clay when the user picks nothing', async () => {
  const settings = await db.settings.get('app')
  await softDelete('clays', settings?.defaultClayId as string)
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: 'Done' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const [piece] = await db.pieces.toArray()
  expect(piece.clayId).toBeUndefined()
})
