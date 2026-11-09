import { GlazetteDB } from '../db/db'
import type { Photo } from '../db/types'
import { onLocalChange, quietly } from '../sync/track'
import { realBlobs } from '../test/realBlobs'
import { bytesOf, moveBytesApart } from './bytes'

const T1 = '2026-01-01T00:00:00.000Z'
const HASH = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const full = (text = 'full') => new Blob([text], { type: 'image/jpeg' })
const small = (text = 'thumb') => new Blob([text], { type: 'image/jpeg' })

const details = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: HASH,
  width: 1,
  height: 1,
  takenAt: T1,
  updatedAt: T1,
  ...extra,
})

/** A row from before the move, its bytes still on it. */
const notMoved = (id: string, extra: Partial<Photo> = {}): Photo =>
  details(id, { blob: full(), thumb: small(), ...extra })

let name: string
let db: GlazetteDB
let real: ReturnType<typeof realBlobs>

const seed = (rows: Photo[]) => quietly(db, () => db.photos.bulkAdd(rows))

beforeEach(async () => {
  name = `bytes-${crypto.randomUUID()}`
  db = new GlazetteDB(name)
  await db.open()
  real = realBlobs()
  real.watch(db)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
})

test('moving takes the bytes off the row and into the table', async () => {
  const row = notMoved('ph1')
  await seed([row])
  await moveBytesApart(db)
  const moved = await db.photos.get('ph1')
  expect(moved).toEqual(details('ph1'))
  expect(moved).not.toHaveProperty('blob')
  expect(moved).not.toHaveProperty('thumb')
  const entry = await db.photoBytes.get(HASH)
  expect(entry?.hash).toBe(HASH)
  expect(entry?.blob).toBe(row.blob)
  expect(entry?.thumb).toBe(row.thumb)
})

test("moving keeps what's already in the table", async () => {
  const kept = { hash: HASH, blob: full('first'), thumb: small('first') }
  await quietly(db, () => db.photoBytes.add(kept))
  await seed([notMoved('ph1'), notMoved('ph2')])
  await moveBytesApart(db)
  expect(await db.photoBytes.count()).toBe(1)
  const entry = await db.photoBytes.get(HASH)
  expect(entry?.blob).toBe(kept.blob)
  expect(entry?.thumb).toBe(kept.thumb)
  expect((await db.photos.get('ph1'))?.blob).toBeUndefined()
  expect((await db.photos.get('ph2'))?.blob).toBeUndefined()
})

test('rows with one hash share one entry, whichever moves first', async () => {
  const first = notMoved('ph1')
  await seed([first, notMoved('ph2')])
  await moveBytesApart(db)
  expect(await db.photoBytes.count()).toBe(1)
  expect((await db.photoBytes.get(HASH))?.blob).toBe(first.blob)
})

test("deleted and merged-away rows move too, so their bytes aren't left behind", async () => {
  await seed([
    notMoved('gone', { deletedAt: T1 }),
    notMoved('dup', { hash: OTHER, deletedAt: T1, mergedInto: 'live' }),
  ])
  await moveBytesApart(db)
  expect(await db.photoBytes.count()).toBe(2)
  expect((await db.photos.get('gone'))?.blob).toBeUndefined()
  expect((await db.photos.get('dup'))?.blob).toBeUndefined()
})

test("one row failing doesn't stop the others", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bad = notMoved('ph1', { hash: OTHER })
  await seed([bad, notMoved('ph2')])
  db.photoBytes.hook('creating', (hash) => {
    if (hash === OTHER) throw new Error('no room')
  })
  await moveBytesApart(db)
  expect(error).toHaveBeenCalledTimes(1)
  expect((await db.photos.get('ph1'))?.blob).toBe(bad.blob)
  expect(await db.photoBytes.get(OTHER)).toBeUndefined()
  expect((await db.photos.get('ph2'))?.blob).toBeUndefined()
  expect(await db.photoBytes.get(HASH)).toBeDefined()
})

test('the bytes leave the row only if the table got them, and the reverse', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const row = notMoved('ph1')
  await seed([row])
  db.photos.hook('updating', () => {
    throw new Error('the row write failed')
  })
  await moveBytesApart(db)
  expect(error).toHaveBeenCalledTimes(1)
  expect((await db.photos.get('ph1'))?.blob).toBe(row.blob)
  expect(await db.photoBytes.count()).toBe(0)
})

test('a move marks nothing as changed', async () => {
  await seed([notMoved('ph1')])
  const heard = vi.fn()
  const stop = onLocalChange(db, heard)
  await moveBytesApart(db)
  await new Promise((resolve) => setTimeout(resolve, 0))
  stop()
  expect(heard).not.toHaveBeenCalled()
  const row = await db.photos.get('ph1')
  expect(row?.dirty).toBeUndefined()
  expect(row?.needsUpload).toBeUndefined()
  expect(row?.updatedAt).toBe(T1)
})

test('a move keeps the flags a row already has', async () => {
  await seed([notMoved('ph1', { dirty: 1, needsUpload: 1 })])
  await moveBytesApart(db)
  expect(await db.photos.get('ph1')).toEqual(
    details('ph1', { dirty: 1, needsUpload: 1 }),
  )
})

test('moving twice is safe', async () => {
  const row = notMoved('ph1')
  await seed([row])
  await moveBytesApart(db)
  await moveBytesApart(db)
  expect(await db.photoBytes.count()).toBe(1)
  expect((await db.photoBytes.get(HASH))?.blob).toBe(row.blob)
  expect(await db.photos.get('ph1')).toEqual(details('ph1'))
})

test('a row that failed is tried again on the next run', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const row = notMoved('ph1')
  await seed([row])
  let refuse = true
  db.photoBytes.hook('creating', () => {
    if (refuse) throw new Error('no room')
  })
  await moveBytesApart(db)
  expect((await db.photos.get('ph1'))?.blob).toBe(row.blob)
  expect(error).toHaveBeenCalledTimes(1)

  refuse = false
  await moveBytesApart(db)
  expect((await db.photos.get('ph1'))?.blob).toBeUndefined()
  expect((await db.photoBytes.get(HASH))?.blob).toBe(row.blob)
})

test("once nothing is left to move, it isn't scanned again until the app next opens", async () => {
  await moveBytesApart(db)
  const scan = vi.spyOn(db.photos, 'filter')
  await moveBytesApart(db)
  expect(scan).not.toHaveBeenCalled()

  // No code writes bytes to a row any more; this stands in for a row the first
  // scan couldn't have seen, to show that a newly opened app looks again.
  await seed([notMoved('late')])
  db.close()
  db = new GlazetteDB(name)
  await db.open()
  await moveBytesApart(db)
  expect((await db.photos.get('late'))?.blob).toBeUndefined()
  expect(await db.photoBytes.get(HASH)).toBeDefined()
})

test('a scan that fails is logged, never thrown, and runs again next time', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await seed([notMoved('ph1')])
  const scan = vi.spyOn(db.photos, 'filter').mockImplementationOnce(() => {
    throw new Error('the scan failed')
  })
  await expect(moveBytesApart(db)).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledTimes(1)
  expect((await db.photos.get('ph1'))?.blob).toBeDefined()

  await moveBytesApart(db)
  expect(scan).toHaveBeenCalledTimes(2)
  expect((await db.photos.get('ph1'))?.blob).toBeUndefined()
})

test('bytesOf prefers the table and falls back to the row', async () => {
  const entry = { hash: HASH, blob: full('table'), thumb: small('table') }
  await quietly(db, () => db.photoBytes.add(entry))
  const row = notMoved('ph1')
  expect(await bytesOf(db, row)).toEqual({
    blob: entry.blob,
    thumb: entry.thumb,
  })
  expect((await bytesOf(db, row))?.blob).toBe(entry.blob)

  const elsewhere = notMoved('ph2', { hash: OTHER })
  const own = await bytesOf(db, elsewhere)
  expect(own?.blob).toBe(elsewhere.blob)
  expect(own?.thumb).toBe(elsewhere.thumb)
})

test('bytesOf finds nothing for a photo with no bytes here', async () => {
  expect(await bytesOf(db, details('ph1'))).toBeUndefined()
})
