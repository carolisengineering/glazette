import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { bytesOf } from '../photos/bytes'
import { realBlobs } from '../test/realBlobs'
import { PiecePhotoGrid, usePickablePhotoIds } from './PiecePhotoGrid'

// The real read, watched so a test can count it or hold it.
vi.mock('../photos/bytes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../photos/bytes')>()
  return { ...actual, bytesOf: vi.fn(actual.bytesOf) }
})

// The shared database keeps its hooks across tests, so watch it once.
realBlobs().watch(db)

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

const row = (id: string, hash: string, over = {}) => ({
  id,
  hash,
  width: 3000,
  height: 4000,
  takenAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

test("usePickablePhotoIds leaves out a photo whose bytes aren't on this device", async () => {
  await db.photos.bulkAdd([
    row('here', 'h1'),
    row('later', 'h2', { needsDownload: 1 }),
    row('gone', 'h3', { deletedAt: '2026-11-02T00:00:00.000Z' }),
  ])
  await db.photoBytes.bulkAdd([
    { hash: 'h1', blob: new Blob(['full']), thumb: new Blob(['th']) },
    { hash: 'h3', blob: new Blob(['full']), thumb: new Blob(['th']) },
  ])
  const { result } = renderHook(() =>
    usePickablePhotoIds(['later', 'here', 'gone']),
  )
  await waitFor(() => expect(result.current).toEqual(['here']))
})

test('PiecePhotoGrid shows one tile per photo it is given', async () => {
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['p1', 'p2']}
      onPick={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('dialog', { name: 'Pieces in Celadon' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Photo 1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Photo 2' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Photo 3' })).toBeNull()
})

test("PiecePhotoGrid says so when a tapped photo's bytes aren't on this device", async () => {
  await db.photos.add(row('later', 'h2', { needsDownload: 1 }))
  const onPick = vi.fn()
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['later']}
      onPick={onPick}
      onCancel={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "That photo isn't on this device yet.",
  )
  expect(onPick).not.toHaveBeenCalled()
})

test('PiecePhotoGrid says so when a tapped photo fails to read', async () => {
  vi.spyOn(db.photos, 'get').mockRejectedValue(new Error('read failed'))
  const onPick = vi.fn()
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['p1']}
      onPick={onPick}
      onCancel={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Photo 1' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't open this photo. Try again.",
  )
  expect(onPick).not.toHaveBeenCalled()
})

test('PiecePhotoGrid reads a photo once when it is tapped twice', async () => {
  await db.photos.add(row('p1', 'h1'))
  await db.photoBytes.add({
    hash: 'h1',
    blob: new Blob(['full']),
    thumb: new Blob(['th']),
  })
  const { bytesOf: realBytesOf } =
    await vi.importActual<typeof import('../photos/bytes')>('../photos/bytes')
  const read = vi.mocked(bytesOf)
  read.mockClear()
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  read.mockImplementationOnce(async (...args) => {
    await held
    return realBytesOf(...args)
  })
  const onPick = vi.fn()
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['p1']}
      onPick={onPick}
      onCancel={vi.fn()}
    />,
  )
  const tile = screen.getByRole('button', { name: 'Photo 1' })
  await userEvent.click(tile)
  await userEvent.click(tile)
  release()
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
  expect(read).toHaveBeenCalledTimes(1)
})

test("PiecePhotoGrid passes the full photo's blob and size to onPick", async () => {
  const full = new Blob(['full'])
  await db.photos.add(row('p1', 'h1'))
  await db.photoBytes.add({ hash: 'h1', blob: full, thumb: new Blob(['th']) })
  const onPick = vi.fn()
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['p1']}
      onPick={onPick}
      onCancel={vi.fn()}
    />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Photo 1' }))
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
  const picked = onPick.mock.calls[0][0]
  expect(picked.blob).toBe(full)
  expect(picked.width).toBe(3000)
  expect(picked.height).toBe(4000)
})
