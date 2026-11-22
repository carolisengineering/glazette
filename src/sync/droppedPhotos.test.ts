import { GlazetteDB } from '../db/db'
import type { Combo, Glaze, Photo, StageEntry } from '../db/types'
import {
  type DroppedPhoto,
  holdDropped,
  releaseDropped,
  releaseHeld,
} from './droppedPhotos'
import { quietly } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`dropped-photos-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: 'a'.repeat(64),
  width: 1,
  height: 1,
  takenAt: T1,
  updatedAt: T2,
  ...extra,
})

const step = (id: string, extra: Partial<StageEntry> = {}): StageEntry => ({
  id,
  pieceId: 'p1',
  stage: 'bisqued',
  photoId: 'ph2',
  updatedAt: T1,
  ...extra,
})

const glaze = (extra: Partial<Glaze> = {}): Glaze => ({
  id: 'g1',
  name: 'Celadon',
  color: '#88aa99',
  swatchPhotoId: 'ph2',
  updatedAt: T1,
  ...extra,
})

const combo = (extra: Partial<Combo> = {}): Combo => ({
  id: 'combo-1',
  layers: ['g1', 'g2'],
  swatchPhotoId: 'ph2',
  updatedAt: T1,
  ...extra,
})

const drop = (extra: Partial<DroppedPhoto> = {}): DroppedPhoto => ({
  photoId: 'ph2',
  pieceId: 'p1',
  entryId: 'e1',
  stage: 'glazed',
  ...extra,
})

/** Rows written exactly as given, so nothing is stamped or marked. */
const seed = (rows: {
  photos?: Photo[]
  steps?: StageEntry[]
  glazes?: Glaze[]
  combos?: Combo[]
}) =>
  quietly(db, async () => {
    await db.photos.bulkAdd(rows.photos ?? [])
    await db.entries.bulkAdd(rows.steps ?? [])
    await db.glazes.bulkAdd(rows.glazes ?? [])
    await db.combos.bulkAdd(rows.combos ?? [])
  })

test('a dropped photo nothing shows goes to Recently Deleted with its place', async () => {
  await seed({ photos: [photo('ph2')] })

  expect(await releaseDropped(db, [drop()])).toBe(1)

  const row = await db.photos.get('ph2')
  expect(row?.deletedAt).toBeTruthy()
  expect(row).toMatchObject({
    lastPieceId: 'p1',
    lastEntryId: 'e1',
    lastStage: 'glazed',
    dirty: 1,
  })
  expect(row?.updatedAt && row.updatedAt > T2).toBe(true)
})

describe('a photo a live step, glaze or combo still shows stays', () => {
  test.each([
    ['step', { steps: [step('e2')] }],
    ['glaze', { glazes: [glaze()] }],
    ['combo', { combos: [combo()] }],
  ])('a live %s', async (_name, rows) => {
    await seed({ photos: [photo('ph2')], ...rows })

    expect(await releaseDropped(db, [drop()])).toBe(0)

    expect((await db.photos.get('ph2'))?.deletedAt).toBeUndefined()
  })
})

describe('a deleted step, glaze or combo showing it does not keep it', () => {
  test.each([
    ['step', { steps: [step('e2', { deletedAt: T1 })] }],
    ['glaze', { glazes: [glaze({ deletedAt: T1 })] }],
    ['combo', { combos: [combo({ deletedAt: T1 })] }],
  ])('a deleted %s', async (_name, rows) => {
    await seed({ photos: [photo('ph2')], ...rows })

    expect(await releaseDropped(db, [drop()])).toBe(1)

    expect((await db.photos.get('ph2'))?.deletedAt).toBeTruthy()
  })
})

describe('a missing, deleted, purged or merged photo is left alone', () => {
  test.each([
    ['missing', undefined],
    ['deleted', photo('ph2', { deletedAt: T1 })],
    ['purged', photo('ph2', { deletedAt: T1, purgedAt: T1 })],
    ['merged', photo('ph2', { deletedAt: T1, mergedInto: 'ph9' })],
    ['merged but not deleted', photo('ph2', { mergedInto: 'ph9' })],
  ])('%s', async (_name, row) => {
    await seed({ photos: row ? [row] : [] })

    expect(await releaseDropped(db, [drop()])).toBe(0)

    expect(await db.photos.get('ph2')).toEqual(row)
  })
})

test('the same photo dropped twice is released once', async () => {
  await seed({ photos: [photo('ph2')] })

  expect(
    await releaseDropped(db, [drop(), drop({ entryId: 'e3', stage: 'fired' })]),
  ).toBe(1)

  expect(await db.photos.get('ph2')).toMatchObject({
    lastEntryId: 'e1',
    lastStage: 'glazed',
  })
})

test('nothing dropped writes nothing', async () => {
  expect(await releaseDropped(db, [])).toBe(0)
})

describe('dropped photos held until they are released', () => {
  test('held drops are released later and then forgotten', async () => {
    await seed({ photos: [photo('ph2'), photo('ph3')] })

    await holdDropped(db, [drop()])
    await holdDropped(db, [drop({ photoId: 'ph3', entryId: 'e3' })])

    expect(await releaseHeld(db)).toBe(2)
    expect(await db.photos.get('ph2')).toMatchObject({ lastEntryId: 'e1' })
    expect(await db.photos.get('ph3')).toMatchObject({ lastEntryId: 'e3' })
    expect(await releaseHeld(db)).toBe(0)
  })

  test('holding nothing and releasing nothing leave the sync state alone', async () => {
    await holdDropped(db, [])

    expect(await releaseHeld(db)).toBe(0)
    expect(await db.syncState.count()).toBe(0)
  })

  test('a held drop that is no longer stranded is let go without a release', async () => {
    await seed({ photos: [photo('ph2')], steps: [step('e2')] })
    await holdDropped(db, [drop()])

    expect(await releaseHeld(db)).toBe(0)
    expect(await db.syncState.count()).toBe(0)
  })

  test('holding sits beside the sync state without changing it', async () => {
    await db.syncState.put({
      id: 'state',
      account: 'me@example.com',
      cursor: 7,
      lastSyncedAt: T1,
    })

    await holdDropped(db, [drop()])

    expect(await db.syncState.get('state')).toEqual({
      id: 'state',
      account: 'me@example.com',
      cursor: 7,
      lastSyncedAt: T1,
    })
  })
})
