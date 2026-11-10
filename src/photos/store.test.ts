import { db } from '../db/db'
import { onLocalChange } from '../sync/track'
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
  db.transaction('rw', db.photos, db.photoBytes, () => storePhoto(photo))

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

test("a new photo's bytes go to the table and it waits to upload", async () => {
  const heard = vi.fn()
  const stop = onLocalChange(db, heard)
  const id = await store(fake('h1'))
  stop()
  const row = await db.photos.get(id)
  expect(row).toMatchObject({ hash: 'h1', dirty: 1, needsUpload: 1 })
  expect(row).not.toHaveProperty('blob')
  expect(row).not.toHaveProperty('thumb')
  const entry = await db.photoBytes.get('h1')
  expect(entry?.blob).toBeDefined()
  expect(entry?.thumb).toBeDefined()
  expect(heard).toHaveBeenCalledTimes(1)
})

test('the same image twice is stored once', async () => {
  await store(fake('h1'))
  const put = vi.spyOn(db.photoBytes, 'add')
  const put2 = vi.spyOn(db.photoBytes, 'put')
  await store(fake('h1'))
  expect(put).not.toHaveBeenCalled()
  expect(put2).not.toHaveBeenCalled()
  expect(await db.photoBytes.count()).toBe(1)
  vi.restoreAllMocks()
})

test('storing an image that is waiting to download fills it in', async () => {
  await db.photos.add({
    id: 'ph1',
    hash: 'h1',
    width: 2000,
    height: 1500,
    takenAt: '2026-11-01T10:00:00.000Z',
    needsDownload: 1,
  })
  const heard = vi.fn()
  const stop = onLocalChange(db, heard)
  const id = await store(fake('h1'))
  stop()
  expect(id).toBe('ph1')
  const row = await db.photos.get('ph1')
  expect(row).not.toHaveProperty('blob')
  expect(row?.needsUpload).toBe(1)
  expect(row?.needsDownload).toBeUndefined()
  expect(await db.photoBytes.get('h1')).toBeDefined()
  expect(await db.photos.count()).toBe(1)
  // Bytes arriving starts an upload, even with nothing else in the transaction.
  expect(heard).toHaveBeenCalledTimes(1)
})

test("a match whose bytes are still on its row isn't given them again", async () => {
  await db.photos.add({
    id: 'ph1',
    hash: 'h1',
    blob: new Blob(['full']),
    thumb: new Blob(['thumb']),
    width: 2000,
    height: 1500,
    takenAt: '2026-11-01T10:00:00.000Z',
  })
  expect(await store(fake('h1'))).toBe('ph1')
  expect(await db.photoBytes.count()).toBe(0)
  expect((await db.photos.get('ph1'))?.needsUpload).toBeUndefined()
})

test('a match whose bytes are already in the table keeps them', async () => {
  const entry = { hash: 'h1', blob: new Blob(['first']) }
  await db.photoBytes.add(entry)
  await db.photos.add({
    id: 'ph1',
    hash: 'h1',
    width: 2000,
    height: 1500,
    takenAt: '2026-11-01T10:00:00.000Z',
  })
  const put = vi.spyOn(db.photoBytes, 'add')
  expect(await store(fake('h1'))).toBe('ph1')
  expect(put).not.toHaveBeenCalled()
  expect((await db.photos.get('ph1'))?.needsUpload).toBeUndefined()
  vi.restoreAllMocks()
})

test('a merged duplicate is never reused', async () => {
  await db.photos.add({
    id: 'dup',
    hash: 'h1',
    width: 1,
    height: 1,
    takenAt: '2026-11-01T10:00:00.000Z',
    mergedInto: 'live',
    deletedAt: '2026-11-02T10:00:00.000Z',
  })
  await db.photos.add({
    id: 'live',
    hash: 'h1',
    blob: new Blob(['full']),
    thumb: new Blob(['thumb']),
    width: 1,
    height: 1,
    takenAt: '2026-11-01T10:00:00.000Z',
  })
  expect(await store(fake('h1'))).toBe('live')
  expect((await db.photos.get('dup'))?.deletedAt).toBeDefined()
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

test("a purged photo isn't reused", async () => {
  const purged = {
    id: 'old',
    hash: 'h1',
    width: 2000,
    height: 1500,
    takenAt: '2026-11-01T10:00:00.000Z',
    deletedAt: '2026-12-01T10:00:00.000Z',
    purgedAt: '2026-12-01T10:00:00.000Z',
  }
  await db.photos.add(purged)
  const before = await db.photos.get('old')
  const id = await store(fake('h1'))
  expect(id).not.toBe('old')
  expect(await db.photos.get('old')).toEqual(before)
  const row = await db.photos.get(id)
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.purgedAt).toBeUndefined()
  expect(row?.needsUpload).toBe(1)
  expect(await db.photoBytes.get('h1')).toBeDefined()
})

test('reusing a deleted photo clears where it was', async () => {
  const first = await store(fake('h1'))
  await db.photos.update(first, {
    deletedAt: '2026-11-01T11:00:00.000Z',
    lastPieceId: 'p1',
    lastEntryId: 'e1',
    lastStage: 'glazed',
  })
  expect(await store(fake('h1'))).toBe(first)
  const row = await db.photos.get(first)
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.lastPieceId).toBeUndefined()
  expect(row?.lastEntryId).toBeUndefined()
  expect(row?.lastStage).toBeUndefined()
})
