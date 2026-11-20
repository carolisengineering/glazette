import type { SwatchImage } from '../photos/swatchImage'
import { comboId, deleteCombo, saveCombo } from './combos'
import { db } from './db'
import { releaseSwatch } from './swatch'

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

test('comboId is the same for the same layers and differs by order', () => {
  expect(comboId(['a', 'b'])).toBe(comboId(['a', 'b']))
  expect(comboId(['a', 'b'])).not.toBe(comboId(['b', 'a']))
  expect(comboId(['a', 'b'])).not.toBe(comboId(['a', 'b', 'c']))
  expect(comboId(['a', 'b'])).toMatch(/^[A-Za-z0-9-]{1,64}$/)
})

test('comboId spreads 1000 random stacks without a clash', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 1000; i++) {
    const layers = Array.from({ length: 2 + (i % 2) }, () =>
      crypto.randomUUID(),
    )
    ids.add(comboId(layers))
  }
  expect(ids.size).toBe(1000)
})

test('saveCombo stores the photo as a swatch and links it', async () => {
  const layers = ['g1', 'g2']
  const id = await saveCombo(layers, swatch('h1'))
  const combo = await db.combos.get(id)
  expect(id).toBe(comboId(layers))
  expect(combo?.layers).toEqual(layers)
  expect((await db.photos.get(combo?.swatchPhotoId as string))?.swatch).toBe(1)
})

test('saving the same stack again replaces the photo and releases the old one', async () => {
  const id = await saveCombo(['g1', 'g2'], swatch('h1'))
  const oldPhoto = (await db.combos.get(id))?.swatchPhotoId as string
  expect(await saveCombo(['g1', 'g2'], swatch('h2'))).toBe(id)
  const newPhoto = (await db.combos.get(id))?.swatchPhotoId as string
  expect(newPhoto).not.toBe(oldPhoto)
  expect((await db.photos.get(oldPhoto))?.deletedAt).toBeTruthy()
  expect((await db.photos.get(newPhoto))?.deletedAt).toBeUndefined()
})

test('saving over a deleted combo brings it back', async () => {
  const id = await saveCombo(['g1', 'g2'], swatch('h1'))
  await deleteCombo(id)
  await saveCombo(['g1', 'g2'], swatch('h2'))
  const combo = await db.combos.get(id)
  expect(combo?.deletedAt).toBeUndefined()
  const photo = await db.photos.get(combo?.swatchPhotoId as string)
  expect(photo?.hash).toBe('h2')
  expect(photo?.deletedAt).toBeUndefined()
})

test('saving over a deleted combo from a clock that ran ahead is dated after its delete', async () => {
  const FUTURE = '2099-01-01T00:00:00.000Z'
  const id = comboId(['g1', 'g2'])
  await db.combos.add({
    id,
    layers: ['g1', 'g2'],
    swatchPhotoId: 'old',
    deletedAt: FUTURE,
    updatedAt: FUTURE,
  })
  await saveCombo(['g1', 'g2'], swatch('h1'))
  const combo = await db.combos.get(id)
  expect(combo?.deletedAt).toBeUndefined()
  expect(combo?.updatedAt).toBe('2099-01-01T00:00:00.001Z')
})

test('deleteCombo soft-deletes and releases its swatch', async () => {
  const id = await saveCombo(['g1', 'g2'], swatch('h1'))
  const photoId = (await db.combos.get(id))?.swatchPhotoId as string
  await deleteCombo(id)
  expect((await db.combos.get(id))?.deletedAt).toBeTruthy()
  expect((await db.photos.get(photoId))?.deletedAt).toBeTruthy()
})

test('a photo shared with a glaze swatch stays when the combo goes', async () => {
  const id = await saveCombo(['g1', 'g2'], swatch('h1'))
  const photoId = (await db.combos.get(id))?.swatchPhotoId as string
  await db.glazes.add({
    id: 'g1',
    name: 'Celadon',
    color: '#aaaaaa',
    swatchPhotoId: photoId,
  })
  await deleteCombo(id)
  expect((await db.photos.get(photoId))?.deletedAt).toBeUndefined()
})

test('a hidden combo still keeps its swatch', async () => {
  await db.glazes.add({ id: 'g1', name: 'A', color: '#aaaaaa' })
  await db.glazes.add({
    id: 'g2',
    name: 'B',
    color: '#bbbbbb',
    deletedAt: '2026-11-19T00:00:00.000Z',
  })
  const id = await saveCombo(['g1', 'g2'], swatch('h1'))
  const photoId = (await db.combos.get(id))?.swatchPhotoId as string
  await db.transaction('rw', db.glazes, db.combos, db.photos, () =>
    releaseSwatch(db, photoId, '2026-11-19T01:00:00.000Z'),
  )
  expect((await db.photos.get(photoId))?.deletedAt).toBeUndefined()
})
