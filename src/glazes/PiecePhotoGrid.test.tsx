import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { realBlobs } from '../test/realBlobs'
import { PiecePhotoGrid } from './PiecePhotoGrid'

// The shared database keeps its hooks across tests, so watch it once.
realBlobs().watch(db)

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

test("PiecePhotoGrid hides a photo whose bytes aren't on this device", async () => {
  await db.photos.bulkAdd([
    row('here', 'h1'),
    row('later', 'h2', { needsDownload: 1 }),
  ])
  await db.photoBytes.add({
    hash: 'h1',
    blob: new Blob(['full']),
    thumb: new Blob(['th']),
  })
  render(
    <PiecePhotoGrid
      glazeName="Celadon"
      photoIds={['later', 'here']}
      onPick={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(
    await screen.findByRole('button', { name: 'Photo 1' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Photo 2' })).toBeNull()
  expect(
    screen.getByRole('dialog', { name: 'Pieces in Celadon' }),
  ).toBeInTheDocument()
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
