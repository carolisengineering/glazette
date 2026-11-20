import { GlazetteDB } from '../db/db'
import type { Combo, Glaze, Photo, StageEntry } from '../db/types'
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
    [
      photo('b-x', { needsUpload: 1, needsDownload: 1 }),
      photo('a-y', { needsDownload: 1 }),
    ],
    [step('e1', 'b-x'), step('e2', 'a-y')],
  )
  expect(await mergePhotosByHash(db)).toBe(1)
  const kept = await db.photos.get('a-y')
  const gone = await db.photos.get('b-x')
  expect(kept?.deletedAt).toBeUndefined()
  expect(gone?.deletedAt).toBeTruthy()
  expect(gone?.mergedInto).toBe('a-y')
  expect(gone?.needsUpload).toBeUndefined()
  expect(gone?.needsDownload).toBeUndefined()
  expect((await db.entries.get('e1'))?.photoId).toBe('a-y')
  expect((await db.entries.get('e2'))?.photoId).toBe('a-y')
})

test('merging leaves the bytes table alone', async () => {
  const entry = { hash: HASH, blob: new Blob(['full']) }
  await seed([photo('b-x'), photo('a-y')])
  await quietly(db, () => db.photoBytes.add(entry))
  const before = await db.photoBytes.toArray()
  await mergePhotosByHash(db)
  expect(await db.photoBytes.toArray()).toEqual(before)
  expect(before).toHaveLength(1)
})

test('merging leaves bytes on a row not moved yet', async () => {
  await seed([
    photo('a-y', { needsDownload: 1 }),
    photo('b-x', { blob: new Blob(['full']), thumb: new Blob(['t']) }),
  ])
  await mergePhotosByHash(db)
  const kept = await db.photos.get('a-y')
  const gone = await db.photos.get('b-x')
  expect(gone?.mergedInto).toBe('a-y')
  expect(gone?.blob).toBeDefined()
  expect(gone?.thumb).toBeDefined()
  expect(kept?.blob).toBeUndefined()
  expect(kept?.needsDownload).toBe(1)
})

test('the kept row waits to upload if a duplicate did', async () => {
  await seed([photo('a-y'), photo('b-x', { needsUpload: 1 })])
  await mergePhotosByHash(db)
  expect((await db.photos.get('a-y'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b-x'))?.needsUpload).toBeUndefined()
})

test("the kept row doesn't start waiting to upload if no duplicate did", async () => {
  await seed([photo('a-y'), photo('b-x')])
  await mergePhotosByHash(db)
  expect((await db.photos.get('a-y'))?.needsUpload).toBeUndefined()
})

test("a deleted row isn't merged", async () => {
  await seed([photo('a-y'), photo('b-x', { deletedAt: T2, needsUpload: 1 })])
  expect(await mergePhotosByHash(db)).toBe(0)
  const other = await db.photos.get('b-x')
  expect(other?.mergedInto).toBeUndefined()
  expect(other?.needsUpload).toBe(1)
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
    [photo('a-y'), photo('b-x', { deletedAt: T2, mergedInto: 'a-y' })],
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

test('a row another device merged away keeps its bytes and its wait to upload here', async () => {
  await seed([
    photo('a-y', { needsDownload: 1 }),
    photo('b-x', {
      deletedAt: T2,
      mergedInto: 'a-y',
      blob: new Blob(['full']),
      needsUpload: 1,
    }),
  ])
  await mergePhotosByHash(db)
  const gone = await db.photos.get('b-x')
  expect(gone?.blob).toBeDefined()
  expect(gone?.needsUpload).toBe(1)
})

const glaze = (id: string, extra: Partial<Glaze> = {}): Glaze => ({
  id,
  name: id,
  color: '#aabbcc',
  updatedAt: T1,
  ...extra,
})

test("mergePhotosByHash moves a glaze's swatch link to the kept photo", async () => {
  await seed([photo('b-x', { swatch: 1 }), photo('a-y', { swatch: 1 })])
  await quietly(db, () =>
    db.glazes.bulkAdd([
      glaze('g1', { swatchPhotoId: 'b-x' }),
      glaze('g2', { swatchPhotoId: 'b-x', deletedAt: T2 }),
      glaze('g3', { swatchPhotoId: 'a-y' }),
    ]),
  )
  await mergePhotosByHash(db)
  const g1 = await db.glazes.get('g1')
  expect(g1?.swatchPhotoId).toBe('a-y')
  expect(g1?.updatedAt).toBe('2026-01-01T00:00:00.001Z')
  expect(g1?.dirty).toBe(1)
  const g2 = await db.glazes.get('g2')
  expect(g2?.swatchPhotoId).toBe('a-y')
  expect(g2?.updatedAt).toBe('2026-02-01T00:00:00.001Z')
  const g3 = await db.glazes.get('g3')
  expect(g3?.updatedAt).toBe(T1)
  expect(g3?.dirty).toBeUndefined()
})

const combo = (id: string, extra: Partial<Combo> = {}): Combo => ({
  id,
  layers: ['g1', 'g2'],
  swatchPhotoId: 'none',
  updatedAt: T1,
  ...extra,
})

test("mergePhotosByHash moves a combo's swatch link to the kept photo", async () => {
  await seed([photo('b-x', { swatch: 1 }), photo('a-y', { swatch: 1 })])
  await quietly(db, () =>
    db.combos.bulkAdd([
      combo('c1', { swatchPhotoId: 'b-x' }),
      combo('c2', { swatchPhotoId: 'b-x', deletedAt: T2 }),
      combo('c3', { swatchPhotoId: 'a-y' }),
    ]),
  )
  await mergePhotosByHash(db)
  const c1 = await db.combos.get('c1')
  expect(c1?.swatchPhotoId).toBe('a-y')
  expect(c1?.updatedAt).toBe('2026-01-01T00:00:00.001Z')
  expect(c1?.dirty).toBe(1)
  const c2 = await db.combos.get('c2')
  expect(c2?.swatchPhotoId).toBe('a-y')
  expect(c2?.updatedAt).toBe('2026-02-01T00:00:00.001Z')
  const c3 = await db.combos.get('c3')
  expect(c3?.updatedAt).toBe(T1)
  expect(c3?.dirty).toBeUndefined()
})
