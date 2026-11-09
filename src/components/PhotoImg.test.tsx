import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { quietly } from '../sync/track'
import { PhotoImg } from './PhotoImg'

beforeEach(async () => {
  await db.delete()
  await db.open()
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

const details = (over = {}) => ({
  id: 'p1',
  hash: 'h',
  width: 1,
  height: 1,
  takenAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

/** A photo as the app stores it: details on the row, bytes in the table. */
async function addStored(over = {}) {
  await db.photos.add(details(over))
  await db.photoBytes.add({
    hash: 'h',
    blob: new Blob(['full-image'], { type: 'full' }),
    thumb: new Blob(['th'], { type: 'thumb' }),
  })
}

/** A row from before the move, its bytes still on it. */
const notMoved = (over = {}) =>
  details({
    blob: new Blob(['full-image'], { type: 'full' }),
    thumb: new Blob(['th'], { type: 'thumb' }),
    ...over,
  })

test('renders the photo and revokes the object URL on unmount', async () => {
  await addStored()
  const { unmount } = render(<PhotoImg photoId="p1" thumb alt="Mug" />)
  const img = await screen.findByRole('img', { name: 'Mug' })
  const src = img.getAttribute('src')
  expect(src).toMatch(/^blob:/)
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(src)
})

test('renders the full photo when thumb is not requested', async () => {
  await addStored()
  render(<PhotoImg photoId="p1" alt="Mug" />)
  expect(await screen.findByRole('img', { name: 'Mug' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
})

test('a row not moved yet shows its own bytes', async () => {
  await db.photos.add(notMoved())
  render(<PhotoImg photoId="p1" alt="Mug" />)
  expect(await screen.findByRole('img', { name: 'Mug' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
})

test('a photo waiting to download shows a placeholder, then its bytes when they arrive', async () => {
  await db.photos.add(details({ needsDownload: 1 }))
  render(<PhotoImg photoId="p1" alt="Mug" />)
  await waitFor(() => expect(db.photos.get('p1')).resolves.toBeDefined())
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  await quietly(db, async () => {
    await db.photoBytes.add({ hash: 'h', blob: new Blob(['full-image']) })
    await db.photos.update('p1', { needsDownload: undefined })
  })
  expect(await screen.findByRole('img', { name: 'Mug' })).toBeVisible()
})

test("a flag write doesn't reload the image", async () => {
  await addStored()
  render(<PhotoImg photoId="p1" thumb alt="Mug" />)
  const img = await screen.findByRole('img', { name: 'Mug' })
  const src = img.getAttribute('src')
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

  await quietly(db, () => db.photos.update('p1', { needsUpload: 1 }))
  await quietly(db, () => db.photos.update('p1', { needsUpload: undefined }))
  await db.photos.update('p1', { takenAt: '2026-11-02T00:00:00.000Z' })
  await new Promise((resolve) => setTimeout(resolve, 20))

  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(screen.getByRole('img', { name: 'Mug' })).toHaveAttribute('src', src)
})

test('shows a placeholder when the id is missing or the row is missing', async () => {
  const { rerender } = render(<PhotoImg alt="x" />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<PhotoImg photoId="nope" alt="x" />)
  await waitFor(() => expect(db.photos.get('nope')).resolves.toBeUndefined())
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

test('a photo that gets soft-deleted stops rendering', async () => {
  await addStored()
  render(<PhotoImg photoId="p1" alt="x" />)
  expect(await screen.findByRole('img', { name: 'x' })).toBeVisible()
  await db.photos.update('p1', { deletedAt: '2026-11-02' })
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
})
