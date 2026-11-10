import { GlazetteDB } from '../db/db'
import type { Photo, StageEntry } from '../db/types'
import { settlePhotos } from './settlePhotos'
import { onLocalChange, quietly } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`settle-photos-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const T3 = '2026-03-01T00:00:00.000Z'
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

const step = (
  id: string,
  photoId: string | undefined,
  extra: Partial<StageEntry> = {},
): StageEntry => ({
  id,
  pieceId: 'p1',
  stage: 'thrown',
  photoId,
  updatedAt: T1,
  ...extra,
})

/** Rows written exactly as given, so nothing is stamped or marked. */
const seed = (photos: Photo[], steps: StageEntry[] = []) =>
  quietly(db, async () => {
    await db.photos.bulkAdd(photos)
    await db.entries.bulkAdd(steps)
    await db.pieces.add({ id: 'p1', createdAt: T1, updatedAt: T1 })
  })

const heldBytes = () =>
  quietly(db, () => db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) }))

test('a photo whose only step was deleted is deleted, and remembers where it was', async () => {
  await seed(
    [photo('ph1')],
    [
      step('e1', 'ph1', { stage: 'thrown', deletedAt: T2 }),
      step('e2', 'ph1', {
        pieceId: 'p2',
        stage: 'trimmed',
        date: T1,
        deletedAt: T2,
      }),
    ],
  )
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeTruthy()
  // The latest of the deleted steps.
  expect(row).toMatchObject({
    lastPieceId: 'p2',
    lastEntryId: 'e2',
    lastStage: 'trimmed',
    dirty: 1,
  })
})

test('a photo on another live step stays', async () => {
  await seed(
    [photo('ph1')],
    [step('e1', 'ph1', { deletedAt: T2 }), step('e2', 'ph1')],
  )
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.lastPieceId).toBeUndefined()
  expect(row?.dirty).toBeUndefined()
})

test('a photo on a live step of a deleted piece stays', async () => {
  await seed([photo('ph1')], [step('e1', 'ph1')])
  await quietly(db, () => db.pieces.update('p1', { deletedAt: T2 }))
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.dirty).toBeUndefined()
})

test('a deleted photo that a live step shows comes back', async () => {
  await heldBytes()
  await seed(
    [
      photo('ph1', {
        deletedAt: T2,
        lastPieceId: 'p1',
        lastEntryId: 'e1',
        lastStage: 'thrown',
      }),
    ],
    [step('e1', 'ph1', { deletedAt: T2 }), step('e2', 'ph1')],
  )
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.lastPieceId).toBeUndefined()
  expect(row?.lastEntryId).toBeUndefined()
  expect(row?.lastStage).toBeUndefined()
  expect(row?.needsDownload).toBeUndefined()
  expect(row?.dirty).toBe(1)
  // Its change is later than the delete it undoes.
  expect((row?.updatedAt ?? '') > T2).toBe(true)
})

test("a change is dated past the photo's last one when this device's clock is behind", async () => {
  const FUTURE = '2099-01-01T00:00:00.000Z'
  await seed(
    [
      photo('back', { deletedAt: FUTURE }),
      photo('gone', { hash: 'b'.repeat(64), updatedAt: FUTURE }),
    ],
    [step('e1', 'back'), step('e2', 'gone', { deletedAt: T2 })],
  )
  await settlePhotos(db)
  const after = '2099-01-01T00:00:00.001Z'
  expect((await db.photos.get('back'))?.updatedAt).toBe(after)
  expect((await db.photos.get('gone'))?.updatedAt).toBe(after)
})

test('a photo coming back with no bytes waits to download', async () => {
  await seed([photo('ph1', { deletedAt: T2 })], [step('e1', 'ph1')])
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.needsDownload).toBe(1)
})

test('a photo coming back with its bytes still on its row needs no download', async () => {
  await seed(
    [photo('ph1', { deletedAt: T2, blob: new Blob(['full']) })],
    [step('e1', 'ph1')],
  )
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.needsDownload).toBeUndefined()
})

test('a photo no step points at is left alone', async () => {
  await seed([photo('ph1')], [step('e1', undefined, { deletedAt: T2 })])
  await settlePhotos(db)
  expect(await db.photos.get('ph1')).toEqual(photo('ph1'))
})

test('a restore-deleted photo gets its place', async () => {
  await seed(
    [photo('ph1', { deletedAt: T2 })],
    [step('e1', 'ph1', { stage: 'bisqued', deletedAt: T2 })],
  )
  await settlePhotos(db)
  const row = await db.photos.get('ph1')
  expect(row).toMatchObject({
    deletedAt: T2,
    lastPieceId: 'p1',
    lastEntryId: 'e1',
    lastStage: 'bisqued',
    dirty: 1,
  })
})

test('a deleted photo that already has its place keeps it', async () => {
  const placed = photo('ph1', {
    deletedAt: T2,
    lastPieceId: 'p9',
    lastEntryId: 'e9',
    lastStage: 'fired',
  })
  await seed([placed], [step('e1', 'ph1', { deletedAt: T2 })])
  await settlePhotos(db)
  expect(await db.photos.get('ph1')).toEqual(placed)
})

test('merged duplicates and stubs are left alone', async () => {
  const merged = photo('ph-merged', { deletedAt: T2, mergedInto: 'ph-live' })
  const stub = photo('ph-stub', { deletedAt: T3, purgedAt: T3 })
  const liveStub = photo('ph-live-stub', { purgedAt: T3 })
  await seed(
    [merged, stub, liveStub],
    [
      step('e1', 'ph-merged'),
      step('e2', 'ph-stub'),
      step('e3', 'ph-live-stub', { deletedAt: T2 }),
    ],
  )
  await settlePhotos(db)
  expect(await db.photos.get('ph-merged')).toEqual(merged)
  expect(await db.photos.get('ph-stub')).toEqual(stub)
  expect(await db.photos.get('ph-live-stub')).toEqual(liveStub)
})

test('nothing to settle writes nothing', async () => {
  await seed(
    [
      photo('ph1'),
      photo('ph2', {
        deletedAt: T2,
        lastPieceId: 'p1',
        lastEntryId: 'e2',
        lastStage: 'thrown',
      }),
      photo('ph3'),
    ],
    [step('e1', 'ph1'), step('e2', 'ph2', { deletedAt: T2 })],
  )
  const before = await db.photos.toArray()
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)
  await settlePhotos(db)
  stop()
  expect(listener).not.toHaveBeenCalled()
  expect(await db.photos.toArray()).toEqual(before)
})

test('settling twice changes nothing the second time', async () => {
  await seed(
    [
      photo('ph1'),
      photo('ph2', { deletedAt: T2 }),
      photo('ph3', { deletedAt: T2 }),
    ],
    [
      step('e1', 'ph1', { deletedAt: T2 }),
      step('e2', 'ph2'),
      step('e3', 'ph3', { deletedAt: T2 }),
    ],
  )
  await settlePhotos(db)
  const after = await db.photos.toArray()
  const listener = vi.fn()
  const stop = onLocalChange(db, listener)
  await settlePhotos(db)
  stop()
  expect(listener).not.toHaveBeenCalled()
  expect(await db.photos.toArray()).toEqual(after)
})
