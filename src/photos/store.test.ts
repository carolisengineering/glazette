import { db } from '../db/db'
import type { ProcessedImage } from './process'
import { storePhoto } from './store'

const fake = (hash: string): ProcessedImage => ({
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash,
  width: 2000,
  height: 1500,
  takenAt: '2026-11-01T10:00:00.000Z',
})

const store = (photo: ProcessedImage) =>
  db.transaction('rw', db.photos, () => storePhoto(photo))

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('storePhoto returns the same id for the same hash', async () => {
  const first = await store(fake('h1'))
  const second = await store(fake('h1'))
  expect(second).toBe(first)
  expect(await db.photos.count()).toBe(1)
})

test('storePhoto stores a second row for a different hash', async () => {
  const first = await store(fake('h1'))
  const second = await store(fake('h2'))
  expect(second).not.toBe(first)
  expect(await db.photos.count()).toBe(2)
})

test('storePhoto undeletes a soft-deleted photo with the same hash', async () => {
  const first = await store(fake('h1'))
  await db.photos.update(first, { deletedAt: '2026-11-01T11:00:00.000Z' })
  const second = await store(fake('h1'))
  expect(second).toBe(first)
  expect(await db.photos.count()).toBe(1)
  expect((await db.photos.get(first))?.deletedAt).toBeUndefined()
})
