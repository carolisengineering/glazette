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

describe('a purged photo a live step still shows', () => {
  const PURGED = '2026-04-01T00:00:00.000Z'
  const stub = (id: string, extra: Partial<Photo> = {}) =>
    photo(id, { deletedAt: PURGED, purgedAt: PURGED, ...extra })

  test('is re-homed when this device holds its bytes', async () => {
    await heldBytes()
    await seed(
      [stub('ph1')],
      [step('e1', 'ph1'), step('e2', 'ph1', { deletedAt: T2 })],
    )
    const before = await db.photos.get('ph1')
    await settlePhotos(db)

    const photoId = (await db.entries.get('e1'))?.photoId as string
    expect(photoId).not.toBe('ph1')
    const row = await db.photos.get(photoId)
    expect(row).toMatchObject({
      hash: HASH,
      width: 1,
      height: 1,
      takenAt: T1,
      needsUpload: 1,
      dirty: 1,
    })
    expect(row?.deletedAt).toBeUndefined()
    expect(row?.purgedAt).toBeUndefined()
    expect((await db.entries.get('e1'))?.dirty).toBe(1)
    // A deleted step and the stub itself stay as they were.
    expect((await db.entries.get('e2'))?.photoId).toBe('ph1')
    expect(await db.photos.get('ph1')).toEqual(before)
    expect(await db.photoBytes.count()).toBe(1)
  })

  test('is re-homed with bytes still on its row, which go to the table', async () => {
    await seed([stub('ph1', { blob: new Blob(['full']) })], [step('e1', 'ph1')])
    await settlePhotos(db)
    const photoId = (await db.entries.get('e1'))?.photoId as string
    expect(photoId).not.toBe('ph1')
    expect((await db.photos.get(photoId))?.needsUpload).toBe(1)
    expect(await db.photoBytes.get(HASH)).toBeDefined()
    // The stub keeps its own.
    expect((await db.photos.get('ph1'))?.blob).toBeDefined()
  })

  test('is left alone without its bytes', async () => {
    await seed([stub('ph1')], [step('e1', 'ph1')])
    const photos = await db.photos.toArray()
    const steps = await db.entries.toArray()
    const listener = vi.fn()
    const stop = onLocalChange(db, listener)
    await settlePhotos(db)
    stop()
    expect(listener).not.toHaveBeenCalled()
    expect(await db.photos.toArray()).toEqual(photos)
    expect(await db.entries.toArray()).toEqual(steps)
  })

  test('settling again after a re-home changes nothing', async () => {
    await heldBytes()
    await seed([stub('ph1')], [step('e1', 'ph1')])
    await settlePhotos(db)
    const photos = await db.photos.toArray()
    const steps = await db.entries.toArray()
    const listener = vi.fn()
    const stop = onLocalChange(db, listener)
    await settlePhotos(db)
    stop()
    expect(listener).not.toHaveBeenCalled()
    expect(await db.photos.toArray()).toEqual(photos)
    expect(await db.entries.toArray()).toEqual(steps)
    expect(await db.photos.count()).toBe(2)
  })
})

describe('steps that are purged, or on a purged piece', () => {
  const PURGED = '2026-04-01T00:00:00.000Z'
  const purgePiece = (id: string) =>
    quietly(db, () =>
      db.pieces.put({
        id,
        name: 'Blue mug',
        createdAt: T1,
        updatedAt: T1,
        deletedAt: T2,
        purgedAt: PURGED,
      }),
    )

  test("a purged step isn't a deleted photo's place, even when it's later", async () => {
    await seed(
      [photo('ph1')],
      [
        step('e1', 'ph1', { stage: 'thrown', date: T1, deletedAt: T2 }),
        step('e2', 'ph1', {
          pieceId: 'p2',
          stage: 'fired',
          date: T3,
          deletedAt: T2,
          purgedAt: PURGED,
        }),
      ],
    )
    await settlePhotos(db)
    expect(await db.photos.get('ph1')).toMatchObject({
      lastPieceId: 'p1',
      lastEntryId: 'e1',
      lastStage: 'thrown',
    })
  })

  test("a deleted step of a purged piece isn't a deleted photo's place", async () => {
    await purgePiece('p2')
    await seed(
      [photo('ph1', { deletedAt: T2 })],
      [
        step('e1', 'ph1', { stage: 'thrown', date: T1, deletedAt: T2 }),
        step('e2', 'ph1', {
          pieceId: 'p2',
          stage: 'fired',
          date: T3,
          deletedAt: T2,
        }),
      ],
    )
    await settlePhotos(db)
    expect(await db.photos.get('ph1')).toMatchObject({
      lastPieceId: 'p1',
      lastEntryId: 'e1',
      lastStage: 'thrown',
    })
  })

  test('a live step on a purged piece counts as deleted, and is the place', async () => {
    await purgePiece('p2')
    await seed(
      [photo('ph1')],
      [step('e1', 'ph1', { pieceId: 'p2', stage: 'glazed' })],
    )
    await settlePhotos(db)
    const row = await db.photos.get('ph1')
    expect(row?.deletedAt).toBeTruthy()
    expect(row).toMatchObject({
      lastPieceId: 'p2',
      lastEntryId: 'e1',
      lastStage: 'glazed',
      dirty: 1,
    })
  })

  test("a live step on a purged piece doesn't bring a deleted photo back", async () => {
    await purgePiece('p2')
    const gone = photo('ph1', {
      deletedAt: T2,
      lastPieceId: 'p1',
      lastEntryId: 'e9',
      lastStage: 'thrown',
    })
    await seed([gone], [step('e1', 'ph1', { pieceId: 'p2' })])
    await settlePhotos(db)
    expect(await db.photos.get('ph1')).toEqual(gone)
  })

  test("a purged photo isn't re-homed onto a live step of a purged piece", async () => {
    await heldBytes()
    await purgePiece('p2')
    const stub = photo('ph1', { deletedAt: PURGED, purgedAt: PURGED })
    await seed([stub], [step('e1', 'ph1', { pieceId: 'p2' })])
    await settlePhotos(db)
    expect(await db.photos.count()).toBe(1)
    expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
  })
})
