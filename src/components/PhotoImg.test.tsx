import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { PhotoImg } from './PhotoImg'

beforeEach(async () => {
  await db.delete()
  await db.open()
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`)
  URL.revokeObjectURL = vi.fn()
})

const photo = (over = {}) => ({
  id: 'p1',
  blob: new Blob(['full-image'], { type: 'full' }),
  thumb: new Blob(['th'], { type: 'thumb' }),
  hash: 'h',
  width: 1,
  height: 1,
  takenAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

test('renders the photo and revokes the object URL on unmount', async () => {
  await db.photos.add(photo())
  const { unmount } = render(<PhotoImg photoId="p1" thumb alt="Mug" />)
  const img = await screen.findByRole('img', { name: 'Mug' })
  const src = img.getAttribute('src')
  expect(src).toMatch(/^blob:/)
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(src)
})

test('renders the full photo when thumb is not requested', async () => {
  await db.photos.add(photo())
  render(<PhotoImg photoId="p1" alt="Mug" />)
  expect(await screen.findByRole('img', { name: 'Mug' })).toHaveAttribute(
    'src',
    expect.stringMatching(/^blob:/),
  )
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
  await db.photos.add(photo())
  render(<PhotoImg photoId="p1" alt="x" />)
  expect(await screen.findByRole('img', { name: 'x' })).toBeVisible()
  await db.photos.update('p1', { deletedAt: '2026-11-02' })
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
})
