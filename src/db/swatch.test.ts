import type { SwatchImage } from '../photos/swatchImage'
import { saveCombo } from './combos'
import { db } from './db'
import { deleteGlaze, liveSwatchIds, releaseSwatch, saveGlaze } from './swatch'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const swatch = (hash: string): SwatchImage => ({
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash,
  width: 10,
  height: 10,
  takenAt: '2026-11-18T09:00:00.000Z',
  color: '#2b5d86',
})

const base = { name: 'Celadon', color: '#aaaaaa', cone: '6' }

test('saveGlaze with set stores a swatch photo and links it', async () => {
  const id = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const glaze = await db.glazes.get(id)
  const photo = await db.photos.get(glaze?.swatchPhotoId as string)
  expect(photo?.swatch).toBe(1)
  expect(photo?.needsUpload).toBe(1)
  expect(photo?.deletedAt).toBeUndefined()
  expect(glaze?.color).toBe('#2b5d86')
  expect(photo?.hash).toBe('h1')
})

test('saveGlaze with set on a glaze that had a swatch deletes the old one', async () => {
  const id = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const oldId = (await db.glazes.get(id))?.swatchPhotoId as string
  await saveGlaze({ ...base, id }, { kind: 'set', image: swatch('h2') })
  const newId = (await db.glazes.get(id))?.swatchPhotoId as string
  expect(newId).not.toBe(oldId)
  expect((await db.photos.get(oldId))?.deletedAt).toBeTruthy()
  expect((await db.photos.get(newId))?.deletedAt).toBeUndefined()
})

test('saveGlaze with remove clears the link, keeps the color, deletes the photo', async () => {
  const id = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const photoId = (await db.glazes.get(id))?.swatchPhotoId as string
  await saveGlaze({ ...base, color: '#2b5d86', id }, { kind: 'remove' })
  const glaze = await db.glazes.get(id)
  expect(glaze?.swatchPhotoId).toBeUndefined()
  expect(glaze?.color).toBe('#2b5d86')
  expect((await db.photos.get(photoId))?.deletedAt).toBeTruthy()
})

test('saveGlaze with keep leaves the swatch alone', async () => {
  const id = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const photoId = (await db.glazes.get(id))?.swatchPhotoId
  await saveGlaze(
    { id, name: 'Celadon 2', cone: '10', color: '#2b5d86', notes: 'thin' },
    { kind: 'keep' },
  )
  const glaze = await db.glazes.get(id)
  expect(glaze).toMatchObject({ name: 'Celadon 2', cone: '10', notes: 'thin' })
  expect(glaze?.swatchPhotoId).toBe(photoId)
  expect((await db.photos.get(photoId as string))?.deletedAt).toBeUndefined()
})

test('releaseSwatch keeps a photo another live glaze still links', async () => {
  const a = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const photoId = (await db.glazes.get(a))?.swatchPhotoId as string
  const b = await saveGlaze(
    { ...base, name: 'Twin' },
    { kind: 'set', image: swatch('h1') },
  )
  expect((await db.glazes.get(b))?.swatchPhotoId).toBe(photoId)
  await saveGlaze({ ...base, id: a }, { kind: 'remove' })
  expect((await db.photos.get(photoId))?.deletedAt).toBeUndefined()
  await db.transaction('rw', db.glazes, db.photos, () =>
    releaseSwatch(db, photoId, new Date().toISOString()),
  )
  expect((await db.photos.get(photoId))?.deletedAt).toBeUndefined()
})

test('deleteGlaze deletes the glaze and its swatch photo', async () => {
  const id = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const photoId = (await db.glazes.get(id))?.swatchPhotoId as string
  await deleteGlaze(id)
  expect((await db.glazes.get(id))?.deletedAt).toBeTruthy()
  expect((await db.photos.get(photoId))?.deletedAt).toBeTruthy()
})

test('liveSwatchIds skips deleted glazes', async () => {
  const a = await saveGlaze(base, { kind: 'set', image: swatch('h1') })
  const b = await saveGlaze(
    { ...base, name: 'B' },
    { kind: 'set', image: swatch('h2') },
  )
  const aPhoto = (await db.glazes.get(a))?.swatchPhotoId as string
  const bPhoto = (await db.glazes.get(b))?.swatchPhotoId as string
  await deleteGlaze(a)
  expect(await liveSwatchIds(db)).toEqual(new Set([bPhoto]))
  expect((await liveSwatchIds(db)).has(aPhoto)).toBe(false)
})

test("liveSwatchIds includes live combos' swatches, not deleted ones'", async () => {
  const live = await saveCombo(['g1', 'g2'], swatch('h1'))
  const gone = await saveCombo(['g1', 'g3'], swatch('h2'))
  const livePhoto = (await db.combos.get(live))?.swatchPhotoId as string
  const gonePhoto = (await db.combos.get(gone))?.swatchPhotoId as string
  await db.combos.update(gone, { deletedAt: '2026-11-19T00:00:00.000Z' })
  const ids = await liveSwatchIds(db)
  expect(ids.has(livePhoto)).toBe(true)
  expect(ids.has(gonePhoto)).toBe(false)
})
