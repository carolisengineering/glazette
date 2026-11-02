import { db } from '../db/db'
import { processImage } from './process'
import { savePhoto } from './store'

vi.mock('./process', () => ({ processImage: vi.fn() }))

const fake = (hash: string) => ({
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash,
  width: 2000,
  height: 1500,
  takenAt: '2026-11-01T10:00:00.000Z',
})

const file = () => new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.mocked(processImage).mockReset()
})

test('savePhoto returns the same id for a file with the same bytes', async () => {
  vi.mocked(processImage).mockResolvedValue(fake('h1'))
  const first = await savePhoto(file())
  const second = await savePhoto(file())
  expect(second).toBe(first)
  expect(await db.photos.count()).toBe(1)
})

test('savePhoto stores a second row for a different hash', async () => {
  vi.mocked(processImage).mockResolvedValueOnce(fake('h1'))
  vi.mocked(processImage).mockResolvedValueOnce(fake('h2'))
  const first = await savePhoto(file())
  const second = await savePhoto(file())
  expect(second).not.toBe(first)
  expect(await db.photos.count()).toBe(2)
})
