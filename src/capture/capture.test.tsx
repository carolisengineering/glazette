import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SAVE_ERROR } from '../components/useToast'
import { db } from '../db/db'
import * as ops from '../db/ops'
import { createPiece, ensureDefaults, softDelete } from '../db/ops'
import * as queries from '../db/queries'
import {
  type ProcessedImage,
  processImage,
  UnsupportedImageError,
} from '../photos/process'
import { setSinkForTests, type TelemetrySink } from '../telemetry/telemetry'
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
let events: Array<[string, Record<string, unknown>]>

const pieceLogged = () => events.filter(([n]) => n === 'piece_logged')

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
  events = []
  const sink: TelemetrySink = {
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  }
  setSinkForTests(sink)
})

afterEach(() => {
  clickSpy.mockRestore()
  setSinkForTests(undefined)
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

/** Done waits for the sheet to finish loading, so wait for it to be enabled. */
async function clickDone() {
  const done = await screen.findByRole('button', { name: 'Done' })
  await waitFor(() => expect(done).toBeEnabled())
  await userEvent.click(done)
}

test('the camera does not open on arrival; Take photo opens it', async () => {
  renderRoute('/capture')
  expect(
    await screen.findByRole('button', { name: 'Take photo' }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Choose from library' }),
  ).toBeVisible()
  expect(clickSpy).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Take photo' }))
  expect(clickSpy).toHaveBeenCalledTimes(1)
  const input = screen.getByTestId('capture-input')
  expect(clickSpy.mock.contexts[0]).toBe(input)
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

test('details sheet holds the clay chips and Done until the default clay has loaded', async () => {
  renderRoute('/capture')
  await chooseFile()
  await userEvent.click(
    await screen.findByRole('button', { name: 'New piece' }),
  )
  // The piece is created with the default clay; then the sheet's own read is held.
  const real = queries.liveDefaultClayId
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const spy = vi
    .spyOn(queries, 'liveDefaultClayId')
    .mockImplementation(async () => {
      await gate
      return real()
    })
  spy.mockImplementationOnce(real)
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
    await screen.findByText('Saved to your shelf as Thrown')
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'White stoneware' }),
    ).not.toBeInTheDocument()
    release()
    expect(
      await screen.findByRole('button', { name: 'White stoneware' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled(),
    )
  } finally {
    spy.mockRestore()
  }
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
  await clickDone()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const [piece] = await db.pieces.toArray()
  expect(piece.name).toBe('Morning Mug')
  expect(piece.form).toBe('mug')
  expect(useCaptureStore.getState().photo).toBeUndefined()
})

test('Done with nothing filled in leaves name and form unset', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await clickDone()
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
    await waitFor(() => expect(done).toBeEnabled())
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
  await clickDone()
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
  await clickDone()
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
  await clickDone()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const [piece] = await db.pieces.toArray()
  expect(piece.clayId).toBeUndefined()
})

test('Retake on the details sheet soft-deletes the new piece and returns to the camera', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const [piece] = await db.pieces.toArray()
  clickSpy.mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Retake' }))
  // The camera opens in the tap itself, before the soft delete resolves.
  expect(clickSpy).toHaveBeenCalledTimes(1)
  expect(
    await screen.findByRole('button', { name: 'Take photo' }),
  ).toBeVisible()
  expect(useCaptureStore.getState().photo).toBeUndefined()
  expect((await db.pieces.get(piece.id))?.deletedAt).toBeTruthy()
  expect(clickSpy).toHaveBeenCalledTimes(1)
  expect(clickSpy.mock.contexts[0]).toBe(screen.getByTestId('capture-input'))
})

test('Retake on the details sheet shows a toast when the discard fails', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: /^Bisqued/ }))
  await screen.findByText('Saved to your shelf as Bisqued')
  vi.spyOn(ops, 'softDelete').mockRejectedValueOnce(new Error('boom'))
  await userEvent.click(screen.getByRole('button', { name: 'Retake' }))
  expect(
    await screen.findByText(
      "Couldn't discard that piece. It's still on your shelf.",
    ),
  ).toBeVisible()
  // The piece stayed, so it is reported once, with the stage the sheet showed.
  expect(pieceLogged()).toEqual([
    [
      'piece_logged',
      { has_photo: true, stage: 'bisqued', ms: expect.any(Number) },
    ],
  ])
  cleanup()
  await new Promise((r) => setTimeout(r, 50))
  expect(pieceLogged()).toHaveLength(1)
})

test('Cancel goes back to the piece when capture came from one', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/capture?pieceId=${id}`)
  await userEvent.click(await screen.findByRole('link', { name: 'Cancel' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )
})

test('review defaults to New piece when there are no in-progress pieces, Update when there is one', async () => {
  const pressed = async (name: string) =>
    (await screen.findByRole('button', { name })).getAttribute('aria-pressed')
  renderRoute('/capture')
  await chooseFile()
  await waitFor(async () => expect(await pressed('New piece')).toBe('true'))
  expect(await pressed('Update')).toBe('false')
  cleanup()

  await createPiece({ name: 'Mug' })
  useCaptureStore.getState().reset()
  renderRoute('/capture')
  await chooseFile()
  await waitFor(async () => expect(await pressed('Update')).toBe('true'))
  expect(await pressed('New piece')).toBe('false')

  // A choice the user made is never overridden.
  await userEvent.click(
    await screen.findByRole('button', { name: 'New piece' }),
  )
  await createPiece({ name: 'Bowl' })
  await waitFor(async () => expect(await pressed('New piece')).toBe('true'))
  expect(await pressed('Update')).toBe('false')
})

test('Close on review lands on the piece when capture came from one, and replaces the entry', async () => {
  const id = await createPiece({ name: 'Mug' })
  const router = renderRoute(`/capture?pieceId=${id}`)
  await chooseFile()
  await userEvent.click(await screen.findByRole('link', { name: 'Close' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/piece/${id}`),
  )
  act(() => router.history.back())
  await new Promise((r) => setTimeout(r, 50))
  expect(router.state.location.pathname).not.toBe('/capture')
})

test('Close on review lands on the shelf when capture started there', async () => {
  const router = renderRoute('/capture')
  await chooseFile()
  await userEvent.click(await screen.findByRole('link', { name: 'Close' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
})

test('Close on the stage strip lands on the shelf when the piece was picked after tapping + on the shelf', async () => {
  await createPiece({ name: 'Mug' })
  const router = renderRoute('/capture')
  await chooseFile()
  await userEvent.click(await screen.findByRole('button', { name: 'Update' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add to Mug' }),
  )
  await userEvent.click(await screen.findByRole('link', { name: 'Close' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  act(() => router.history.back())
  await new Promise((r) => setTimeout(r, 50))
  expect(router.state.location.pathname).not.toBe('/capture')
})

const stageBtn = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) })

test('picking Bisqued on the details sheet restages the saved piece; the line reads "Saved to your shelf as Bisqued"', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  expect(screen.getByText('Stage')).toBeVisible()
  expect(stageBtn('Thrown')).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(stageBtn('Bisqued'))
  await screen.findByText('Saved to your shelf as Bisqued')
  const live = (await db.entries.toArray()).filter((e) => !e.deletedAt)
  expect(live.map((e) => e.stage).sort()).toEqual([
    'bisqued',
    'thrown',
    'trimmed',
  ])
  expect(live.find((e) => e.stage === 'bisqued')?.photoId).toBeTruthy()
})

test('a failed restage shows a toast and keeps the previous selection', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const spy = vi
    .spyOn(ops, 'restagePiece')
    .mockRejectedValueOnce(new Error('boom'))
  await userEvent.click(stageBtn('Bisqued'))
  spy.mockRestore()
  await screen.findByText(SAVE_ERROR)
  expect(stageBtn('Thrown')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Saved to your shelf as Thrown')).toBeVisible()
})

test('details sheet with a photo at Fired saves glazes on the filled Glazed step on Done', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  expect(screen.queryByLabelText('Glaze 1')).toBeNull()
  await userEvent.click(stageBtn('Fired'))
  await screen.findByText('Saved to your shelf as Fired')
  await userEvent.type(await screen.findByLabelText('Glaze 1'), 'Celadon')
  await clickDone()
  await waitFor(async () => expect(await db.glazeApps.count()).toBe(1))
  const glazed = (await db.entries.toArray()).find((e) => e.stage === 'glazed')
  expect(glazed?.photoId).toBeUndefined()
  const apps = await db.glazeApps.toArray()
  expect(apps[0].entryId).toBe(glazed?.id)
  expect((await db.glazes.toArray()).map((g) => g.name)).toContain('Celadon')
})

async function openNewPieceNoPhoto() {
  const router = renderRoute('/capture')
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  return router
}

test('details sheet without a photo saves nothing until Done, then writes the piece at the chosen stage', async () => {
  const router = await openNewPieceNoPhoto()
  expect(await screen.findByText('New piece')).toBeVisible()
  expect(screen.getByText('No photo')).toBeVisible()
  expect(screen.queryByText(/Saved to your shelf/)).toBeNull()
  await userEvent.click(stageBtn('Glazed'))
  await userEvent.type(screen.getByLabelText('Glaze 1'), 'Tenmoku')
  await userEvent.type(screen.getByPlaceholderText('Name it later'), 'Bowl')
  expect(await db.pieces.count()).toBe(0)
  await clickDone()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const pieces = await db.pieces.toArray()
  expect(pieces).toHaveLength(1)
  expect(pieces[0].name).toBe('Bowl')
  expect(pieces[0].clayId).toBeTruthy()
  const live = (await db.entries.toArray()).filter((e) => !e.deletedAt)
  expect(live.map((e) => e.stage).sort()).toEqual([
    'bisqued',
    'glazed',
    'thrown',
    'trimmed',
  ])
  expect(live.every((e) => !e.photoId)).toBe(true)
  expect(await db.glazeApps.count()).toBe(1)
  expect(await db.photos.count()).toBe(0)
})

test('Close on the no-photo details sheet writes nothing and goes to the shelf', async () => {
  const router = await openNewPieceNoPhoto()
  await userEvent.type(
    await screen.findByPlaceholderText('Name it later'),
    'Bowl',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(await db.pieces.count()).toBe(0)
  expect(await db.entries.count()).toBe(0)
})

test('No photo from a piece opens the stage strip for that piece without a photo', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/capture?pieceId=${id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  expect(await screen.findByText('No photo for this update')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save to Trimmed' })).toBeVisible()
  expect(await db.entries.count()).toBe(1)
})

test('No photo is hidden when capture was opened from Add photo', async () => {
  const id = await createPiece({ name: 'Mug' })
  renderRoute(`/capture?pieceId=${id}&addPhoto=true`)
  await screen.findByRole('button', { name: 'Take photo' })
  expect(screen.queryByRole('button', { name: 'No photo' })).toBeNull()
})

test('No photo from + with pieces in progress shows the Update a piece / New piece choice', async () => {
  await createPiece({ name: 'Mug' })
  const router = renderRoute('/capture')
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  expect(
    await screen.findByRole('button', { name: 'Update a piece' }),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'New piece' })).toBeVisible()
  await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
})

test('No photo from + with nothing in progress goes straight to the new-piece sheet', async () => {
  renderRoute('/capture')
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  expect(await screen.findByPlaceholderText('Name it later')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Update a piece' })).toBeNull()
})

test('No photo is disabled until the pieces have loaded, then goes straight to New piece', async () => {
  const spy = vi.spyOn(queries, 'usePiecesQuery').mockReturnValue(undefined)
  try {
    renderRoute('/capture')
    expect(
      await screen.findByRole('button', { name: 'No photo' }),
    ).toBeDisabled()
  } finally {
    spy.mockRestore()
  }
  cleanup()
  renderRoute('/capture')
  const button = await screen.findByRole('button', { name: 'No photo' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(await screen.findByPlaceholderText('Name it later')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Update a piece' })).toBeNull()
})

test('end to end: + → No photo → New piece → Bisqued → Done leaves a Bisqued piece with Thrown and Trimmed slim rows', async () => {
  await createPiece({ name: 'Mug' })
  const router = renderRoute('/capture')
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'New piece' }),
  )
  await userEvent.click(await screen.findByRole('button', { name: /^Bisqued/ }))
  await clickDone()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  const pieces = (await db.pieces.toArray()).filter((p) => p.name !== 'Mug')
  expect(pieces).toHaveLength(1)
  const entries = (
    await db.entries.where('pieceId').equals(pieces[0].id).toArray()
  ).filter((e) => !e.deletedAt)
  expect(entries.map((e) => e.stage).sort()).toEqual([
    'bisqued',
    'thrown',
    'trimmed',
  ])
  expect(entries.every((e) => !e.photoId)).toBe(true)
})

test('the stage picker and Done are disabled while a restage is in flight, and the final state matches the selection', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  const real = ops.restagePiece
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const spy = vi.spyOn(ops, 'restagePiece').mockImplementation(async (...a) => {
    await gate
    return real(...a)
  })
  try {
    await userEvent.click(stageBtn('Fired'))
    expect(stageBtn('Bisqued')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    await userEvent.click(stageBtn('Bisqued'))
    expect(spy).toHaveBeenCalledTimes(1)
    release()
    await screen.findByText('Saved to your shelf as Fired')
    await waitFor(() => expect(stageBtn('Bisqued')).toBeEnabled())
    const live = (await db.entries.toArray()).filter((e) => !e.deletedAt)
    expect(live.map((e) => e.stage).sort()).toEqual([
      'bisqued',
      'fired',
      'glazed',
      'thrown',
      'trimmed',
    ])
  } finally {
    spy.mockRestore()
  }
})

test('the stage picker is disabled while Done is saving, so glazes land on the shown stage', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  await userEvent.click(stageBtn('Glazed'))
  await screen.findByText('Saved to your shelf as Glazed')
  await userEvent.type(await screen.findByLabelText('Glaze 1'), 'Celadon')
  const real = ops.addGlazesToPiece
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const restage = vi.spyOn(ops, 'restagePiece')
  const add = vi
    .spyOn(ops, 'addGlazesToPiece')
    .mockImplementation(async (...a) => {
      await gate
      return real(...a)
    })
  try {
    await clickDone()
    await waitFor(() => expect(add).toHaveBeenCalled())
    expect(stageBtn('Bisqued')).toBeDisabled()
    await userEvent.click(stageBtn('Bisqued'))
    expect(restage).not.toHaveBeenCalled()
    release()
    await waitFor(async () => expect(await db.glazeApps.count()).toBe(1))
    const glazed = (await db.entries.toArray()).find(
      (e) => e.stage === 'glazed' && !e.deletedAt,
    )
    expect((await db.glazeApps.toArray())[0].entryId).toBe(glazed?.id)
  } finally {
    add.mockRestore()
    restage.mockRestore()
  }
})

test('camera-first: Done reports piece_logged once, with the picked stage', async () => {
  renderRoute('/capture')
  await submitAsNewPiece()
  await userEvent.click(await screen.findByRole('button', { name: /^Bisqued/ }))
  await screen.findByText('Saved to your shelf as Bisqued')
  expect(pieceLogged()).toEqual([])
  await clickDone()
  await waitFor(() => expect(pieceLogged()).toHaveLength(1))
  expect(pieceLogged()[0][1]).toEqual({
    stage: 'bisqued',
    has_photo: true,
    ms: expect.any(Number),
  })
})

test('camera-first: leaving without Done still reports it', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  act(() => {
    void router.navigate({ to: '/' })
  })
  await waitFor(() => expect(pieceLogged()).toHaveLength(1))
  expect(pieceLogged()[0][1]).toMatchObject({ stage: 'thrown' })
})

test('camera-first: Retake reports nothing for the discarded piece', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  await userEvent.click(screen.getByRole('button', { name: 'Retake' }))
  await screen.findByRole('button', { name: 'Take photo' })
  act(() => {
    void router.navigate({ to: '/' })
  })
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  await new Promise((r) => setTimeout(r, 50))
  expect(pieceLogged()).toEqual([])
})

test('Retake, then a new photo and New again, reports only the second piece', async () => {
  const router = renderRoute('/capture')
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  await userEvent.click(screen.getByRole('button', { name: 'Retake' }))
  await screen.findByRole('button', { name: 'Take photo' })
  await submitAsNewPiece()
  await screen.findByText('Saved to your shelf as Thrown')
  expect(await db.pieces.count()).toBe(2)
  await clickDone()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  await waitFor(() => expect(pieceLogged()).toHaveLength(1))
  await new Promise((r) => setTimeout(r, 50))
  expect(pieceLogged()).toHaveLength(1)
  expect(await db.pieces.filter((p) => !p.deletedAt).count()).toBe(1)
})

test('the no-photo new-piece path still reports at save', async () => {
  renderRoute('/capture')
  await userEvent.click(await screen.findByRole('button', { name: 'No photo' }))
  await userEvent.click(await screen.findByRole('button', { name: /^Bisqued/ }))
  await clickDone()
  await waitFor(() => expect(pieceLogged()).toHaveLength(1))
  expect(pieceLogged()[0][1]).toMatchObject({
    stage: 'bisqued',
    has_photo: false,
  })
})

test('camera-first: leaving while the piece is still saving reports it once it lands', async () => {
  const router = renderRoute('/capture')
  const real = ops.createPiece
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const create = vi
    .spyOn(ops, 'createPiece')
    .mockImplementation(async (...a) => {
      await gate
      return real(...a)
    })
  try {
    await submitAsNewPiece()
    await waitFor(() => expect(create).toHaveBeenCalled())
    act(() => {
      void router.navigate({ to: '/' })
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    release()
    await waitFor(() => expect(pieceLogged()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(pieceLogged()).toHaveLength(1)
    expect(pieceLogged()[0][1]).toMatchObject({ stage: 'thrown' })
  } finally {
    create.mockRestore()
  }
})

test('on the pick sheet, Retake and New are disabled while "Save as a new piece" is saving', async () => {
  await createPiece({ name: 'Mug' })
  renderRoute('/capture')
  await chooseFile()
  await userEvent.click(await screen.findByRole('button', { name: 'Update' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
  const newBtn = await screen.findByRole('button', {
    name: 'Not here? Save as a new piece',
  })
  const real = ops.createPiece
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const create = vi
    .spyOn(ops, 'createPiece')
    .mockImplementation(async (...a) => {
      await gate
      return real(...a)
    })
  try {
    await userEvent.click(newBtn)
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(newBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeDisabled()
    release()
    await screen.findByText('Saved to your shelf as Thrown')
    expect(screen.getByPlaceholderText('Name it later')).toBeVisible()
  } finally {
    create.mockRestore()
  }
})
