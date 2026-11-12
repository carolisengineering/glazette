import { db } from './db'
import { putBackPhoto, putBackPiece } from './putBack'
import type { Photo, Piece, StageEntry } from './types'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const HASH = 'a'.repeat(64)

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: T1,
  updatedAt: T1,
  ...extra,
})
const step = (
  id: string,
  pieceId: string,
  extra: Partial<StageEntry> = {},
): StageEntry => ({ id, pieceId, stage: 'thrown', ...extra })
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: HASH,
  width: 1,
  height: 1,
  takenAt: T2,
  ...extra,
})
const holdBytes = () => db.photoBytes.add({ hash: HASH, blob: new Blob(['x']) })

/** Seeds without tracking, as a synced device would hold the rows. */
async function seed(rows: {
  pieces?: Piece[]
  entries?: StageEntry[]
  photos?: Photo[]
}) {
  await db.pieces.bulkAdd(rows.pieces ?? [])
  await db.entries.bulkAdd(rows.entries ?? [])
  await db.photos.bulkAdd(rows.photos ?? [])
  await db.pieces.toCollection().modify({ dirty: undefined })
  await db.entries.toCollection().modify({ dirty: undefined })
  await db.photos.toCollection().modify({ dirty: undefined })
}

const place: Partial<Photo> = {
  lastPieceId: 'p1',
  lastEntryId: 'e1',
  lastStage: 'glazed',
}

test('a piece comes back with its steps and photos', async () => {
  await holdBytes()
  await seed({
    pieces: [piece('p1', { deletedAt: T2 })],
    entries: [step('e1', 'p1', { photoId: 'ph1' })],
    photos: [photo('ph1')],
  })
  await putBackPiece('p1')
  const row = await db.pieces.get('p1')
  expect(row?.deletedAt).toBeUndefined()
  expect((row?.updatedAt as string) > T2).toBe(true)
  expect(await db.entries.get('e1')).toMatchObject({ photoId: 'ph1' })
  expect((await db.entries.get('e1'))?.deletedAt).toBeUndefined()
  expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
})

test("a piece's deleted photo on a live step comes back too", async () => {
  await seed({
    pieces: [piece('p1', { deletedAt: T2 })],
    entries: [step('e1', 'p1', { photoId: 'ph1' })],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  await putBackPiece('p1')
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.lastPieceId).toBeUndefined()
  expect(row?.lastEntryId).toBeUndefined()
  expect(row?.lastStage).toBeUndefined()
})

test('a step deleted before the piece stays deleted', async () => {
  await seed({
    pieces: [piece('p1', { deletedAt: T2 })],
    entries: [
      step('e1', 'p1', { deletedAt: T1, photoId: 'ph1' }),
      step('e2', 'p1', { stage: 'trimmed' }),
    ],
    photos: [photo('ph1', { deletedAt: T1 })],
  })
  await putBackPiece('p1')
  expect((await db.entries.get('e1'))?.deletedAt).toBe(T1)
  expect((await db.photos.get('ph1'))?.deletedAt).toBe(T1)
})

test("a purged piece isn't put back", async () => {
  await seed({ pieces: [piece('p1', { deletedAt: T2, purgedAt: T2 })] })
  const before = await db.pieces.get('p1')
  await putBackPiece('p1')
  expect(await db.pieces.get('p1')).toEqual(before)
})

test("a missing or live piece isn't changed", async () => {
  await seed({ pieces: [piece('p1')] })
  await putBackPiece('p1')
  await putBackPiece('nope')
  expect(await db.pieces.get('p1')).toEqual(piece('p1'))
  expect(await db.pieces.count()).toBe(1)
})

test("a purged or live photo isn't put back", async () => {
  await seed({
    photos: [photo('purged', { deletedAt: T1, purgedAt: T2 }), photo('live')],
  })
  const before = await db.photos.toArray()
  expect(await putBackPhoto('purged')).toBeUndefined()
  expect(await putBackPhoto('live')).toBeUndefined()
  expect(await putBackPhoto('nope')).toBeUndefined()
  expect(await db.photos.toArray()).toEqual(before)
  expect(await db.pieces.count()).toBe(0)
})

test('a photo goes back on its free step', async () => {
  await holdBytes()
  await seed({
    pieces: [piece('p1')],
    entries: [step('e1', 'p1', { stage: 'glazed' })],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  const result = await putBackPhoto('ph1')
  expect(result?.id).toBe('p1')
  expect((result?.updatedAt as string) > T1).toBe(true)
  expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
  expect(await db.entries.count()).toBe(1)
  const row = await db.photos.get('ph1')
  expect(row?.deletedAt).toBeUndefined()
  expect(row?.lastPieceId).toBeUndefined()
  expect(row?.needsDownload).toBeUndefined()
})

test('a photo whose step was deleted gets a new step', async () => {
  await seed({
    pieces: [piece('p1')],
    entries: [
      step('e0', 'p1', { stage: 'thrown' }),
      step('e1', 'p1', { stage: 'glazed', deletedAt: T2 }),
    ],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  await putBackPhoto('ph1')
  const steps = await db.entries.where('pieceId').equals('p1').toArray()
  const added = steps.filter((s) => !['e0', 'e1'].includes(s.id))
  // Trimmed and bisqued fill the way up from thrown, then the photo's step.
  expect(added.map((s) => s.stage).sort()).toEqual(
    ['bisqued', 'glazed', 'trimmed'].sort(),
  )
  expect(added.find((s) => s.stage === 'glazed')?.photoId).toBe('ph1')
  expect((await db.entries.get('e1'))?.deletedAt).toBe(T2)
})

test('a photo whose piece is deleted brings the piece back', async () => {
  await seed({
    pieces: [piece('p1', { deletedAt: T2 })],
    entries: [step('e1', 'p1', { stage: 'glazed' })],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  const result = await putBackPhoto('ph1')
  expect(result?.deletedAt).toBeUndefined()
  expect((await db.pieces.get('p1'))?.deletedAt).toBeUndefined()
  expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
  expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
})

test('a photo with no place becomes a new piece', async () => {
  await seed({ photos: [photo('ph1', { deletedAt: T2 })] })
  const result = await putBackPhoto('ph1')
  expect(result).toMatchObject({ createdAt: T2 })
  expect(result?.name).toBeUndefined()
  expect(await db.pieces.count()).toBe(1)
  const steps = await db.entries.toArray()
  expect(steps).toHaveLength(1)
  expect(steps[0]).toMatchObject({
    pieceId: result?.id,
    stage: 'thrown',
    photoId: 'ph1',
  })
})

test('a photo whose piece was purged becomes a new piece', async () => {
  await seed({
    pieces: [piece('p1', { deletedAt: T1, purgedAt: T1 })],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  const result = await putBackPhoto('ph1')
  expect(result?.id).not.toBe('p1')
  const steps = await db.entries
    .where('pieceId')
    .equals(result?.id as string)
    .toArray()
  expect(steps.map((s) => s.stage).sort()).toEqual(
    ['bisqued', 'glazed', 'thrown', 'trimmed'].sort(),
  )
  expect(steps.find((s) => s.stage === 'glazed')?.photoId).toBe('ph1')
  expect((await db.pieces.get('p1'))?.purgedAt).toBe(T1)
})

test('a photo with no bytes here waits to download', async () => {
  await seed({ photos: [photo('ph1', { deletedAt: T2 })] })
  await putBackPhoto('ph1')
  expect((await db.photos.get('ph1'))?.needsDownload).toBe(1)
})

test('putting back is a change that syncs', async () => {
  await seed({
    pieces: [piece('p1', { deletedAt: T2 })],
    entries: [step('e1', 'p1', { stage: 'glazed' })],
    photos: [photo('ph1', { deletedAt: T2, ...place })],
  })
  await putBackPhoto('ph1')
  const p = await db.pieces.get('p1')
  const e = await db.entries.get('e1')
  const ph = await db.photos.get('ph1')
  for (const row of [p, e, ph]) {
    expect(row?.dirty).toBe(1)
    expect((row?.updatedAt as string) > T2).toBe(true)
  }
})

describe('on a device whose clock is behind the one that deleted', () => {
  const FUTURE = '2099-01-01T00:00:00.000Z'
  const AFTER = '2099-01-01T00:00:00.001Z'

  test('a put-back piece and its photos are dated past the delete', async () => {
    await holdBytes()
    await seed({
      pieces: [piece('p1', { deletedAt: FUTURE })],
      entries: [step('e1', 'p1', { photoId: 'ph1' })],
      photos: [photo('ph1', { deletedAt: FUTURE })],
    })
    await putBackPiece('p1')
    expect((await db.pieces.get('p1'))?.updatedAt).toBe(AFTER)
    expect((await db.photos.get('ph1'))?.updatedAt).toBe(AFTER)
  })

  test('a put-back photo, its step and its piece are dated past their last change', async () => {
    await holdBytes()
    await seed({
      pieces: [piece('p1', { deletedAt: FUTURE })],
      entries: [step('e1', 'p1', { stage: 'glazed', updatedAt: FUTURE })],
      photos: [photo('ph1', { deletedAt: FUTURE, ...place })],
    })
    await putBackPhoto('ph1')
    expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
    expect((await db.pieces.get('p1'))?.updatedAt).toBe(AFTER)
    expect((await db.entries.get('e1'))?.updatedAt).toBe(AFTER)
    expect((await db.photos.get('ph1'))?.updatedAt).toBe(AFTER)
  })
})

describe('a swapped-out photo', () => {
  const swapped = (): Photo =>
    photo('old', { hash: 'b'.repeat(64), deletedAt: T2, ...place })

  test('putting back a swapped-out photo returns it to its step and sends the replacement to Recently Deleted', async () => {
    await seed({
      pieces: [piece('p1')],
      entries: [
        step('e1', 'p1', { stage: 'glazed', photoId: 'new', date: T1 }),
      ],
      photos: [photo('new'), swapped()],
    })
    await putBackPhoto('old')
    const entries = await db.entries.where('pieceId').equals('p1').toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'e1', photoId: 'old', date: T1 })
    expect((await db.photos.get('old'))?.deletedAt).toBeUndefined()
    expect(await db.photos.get('new')).toMatchObject({
      deletedAt: expect.any(String),
      lastPieceId: 'p1',
      lastEntryId: 'e1',
      lastStage: 'glazed',
    })
  })

  test('the replacement stays live when another step shows it', async () => {
    await seed({
      pieces: [piece('p1')],
      entries: [
        step('e1', 'p1', { stage: 'glazed', photoId: 'new' }),
        step('e2', 'p1', { stage: 'fired', photoId: 'new' }),
      ],
      photos: [photo('new'), swapped()],
    })
    await putBackPhoto('old')
    expect((await db.entries.get('e1'))?.photoId).toBe('old')
    expect((await db.entries.get('e2'))?.photoId).toBe('new')
    expect((await db.photos.get('new'))?.deletedAt).toBeUndefined()
  })
})
