import { GlazetteDB } from '../db/db'
import type { Photo, StageEntry } from '../db/types'
import { mergePhotosByHash } from './photoMerge'
import { onLocalChange, quietly } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`photo-merge-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const HASH = 'a'.repeat(64)

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  blob: new Blob([id], { type: 'image/jpeg' }),
  thumb: new Blob(['t'], { type: 'image/jpeg' }),
  hash: HASH,
  width: 1,
  height: 1,
  takenAt: T1,
  updatedAt: T1,
  ...extra,
})

const step = (id: string, photoId: string, extra: Partial<StageEntry> = {}) =>
  ({
    id,
    pieceId: 'p1',
    stage: 'thrown',
    photoId,
    updatedAt: T1,
    ...extra,
  }) as StageEntry

/** Rows written exactly as given, so nothing is stamped or marked. */
const seed = (photos: Photo[], steps: StageEntry[] = []) =>
  quietly(db, async () => {
    await db.photos.bulkAdd(photos)
    await db.entries.bulkAdd(steps)
  })

test('two rows with one hash become one', async () => {
  await seed(
    [photo('b-x'), photo('a-y')],
    [step('e1', 'b-x'), step('e2', 'a-y')],
  )
  expect(await mergePhotosByHash(db)).toBe(1)
  const kept = await db.photos.get('a-y')
  const gone = await db.photos.get('b-x')
  expect(kept?.deletedAt).toBeUndefined()
  expect(kept?.blob).toBeDefined()
  expect(gone?.deletedAt).toBeTruthy()
  expect(gone?.mergedInto).toBe('a-y')
  expect(gone?.blob).toBeUndefined()
  expect(gone?.thumb).toBeUndefined()
  expect(gone?.needsUpload).toBeUndefined()
  expect(gone?.needsDownload).toBeUndefined()
  expect((await db.entries.get('e1'))?.photoId).toBe('a-y')
  expect((await db.entries.get('e2'))?.photoId).toBe('a-y')
})

test('the kept row gets the bytes when it has none', async () => {
  await seed([
    photo('a-y', { blob: undefined, thumb: undefined, needsDownload: 1 }),
    photo('b-x'),
  ])
  await mergePhotosByHash(db)
  const kept = await db.photos.get('a-y')
  expect(kept?.blob).toBeDefined()
  expect(kept?.thumb).toBeDefined()
  expect(kept?.needsDownload).toBeUndefined()
  expect((await db.photos.get('b-x'))?.blob).toBeUndefined()
})

test("a deleted row isn't merged", async () => {
  await seed([photo('a-y'), photo('b-x', { deletedAt: T2 })])
  expect(await mergePhotosByHash(db)).toBe(0)
  const other = await db.photos.get('b-x')
  expect(other?.mergedInto).toBeUndefined()
  expect(other?.blob).toBeDefined()
})

test('nothing to merge changes nothing', async () => {
  await seed([photo('a-y'), photo('b-x', { hash: 'b'.repeat(64) })])
  const before = await db.photos.toArray()
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)
  expect(await mergePhotosByHash(db)).toBe(0)
  stop()
  expect(listener).not.toHaveBeenCalled()
  expect(await db.photos.toArray()).toEqual(before)
})

test('a repoint moves a step just past its last change', async () => {
  await seed([photo('b-x'), photo('a-y')], [step('e1', 'b-x')])
  await mergePhotosByHash(db)
  expect((await db.entries.get('e1'))?.updatedAt).toBe(
    '2026-01-01T00:00:00.001Z',
  )
})

test('a step pointing at a merged-away photo follows it', async () => {
  await seed(
    [
      photo('a-y'),
      photo('b-x', { deletedAt: T2, mergedInto: 'a-y', blob: undefined }),
    ],
    [step('e1', 'b-x')],
  )
  await mergePhotosByHash(db)
  expect((await db.entries.get('e1'))?.photoId).toBe('a-y')
})

test('a chain of merges is followed to its end', async () => {
  await seed(
    [
      photo('c-z', { hash: 'c'.repeat(64) }),
      photo('b-y', { hash: 'b'.repeat(64), deletedAt: T2, mergedInto: 'c-z' }),
      photo('a-x', { deletedAt: T2, mergedInto: 'b-y' }),
    ],
    [step('e1', 'a-x'), step('e2', 'b-y', { deletedAt: T2 })],
  )
  await mergePhotosByHash(db)
  expect((await db.entries.get('e1'))?.photoId).toBe('c-z')
  expect((await db.entries.get('e2'))?.photoId).toBe('c-z')
})
