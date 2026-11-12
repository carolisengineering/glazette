import type { ProcessedImage } from '../photos/process'
import { db } from './db'
import {
  addPhotoToStep,
  saveStepDetails,
  setStepGlazes,
  undoPhotoSwap,
} from './stepEdits'
import type { GlazeApplication, Piece, StageEntry } from './types'

const T1 = '2026-01-01T00:00:00.000Z'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seed(stage: StageEntry['stage'], glazeIds: string[]) {
  const piece: Piece = { id: 'p1', createdAt: T1, updatedAt: T1 }
  await db.pieces.add(piece)
  await db.entries.add({ id: 'e1', pieceId: 'p1', stage })
  await db.glazeApps.bulkAdd(
    glazeIds.map((glazeId, i) => ({
      id: `a${i}`,
      entryId: 'e1',
      pieceId: 'p1',
      glazeId,
      order: i,
    })),
  )
}

const live = async (): Promise<GlazeApplication[]> =>
  (await db.glazeApps.where('entryId').equals('e1').toArray())
    .filter((a) => !a.deletedAt)
    .sort((a, b) => a.order - b.order)

test('adds glazes to a Glazed step logged without any', async () => {
  await seed('glazed', [])
  expect(await setStepGlazes('e1', [{ glazeId: 'A' }, { glazeId: 'B' }])).toBe(
    true,
  )
  const apps = await live()
  expect(apps.map((a) => [a.glazeId, a.order])).toEqual([
    ['A', 0],
    ['B', 1],
  ])
})

test('reorders by updating rows in place', async () => {
  await seed('glazed', ['A', 'B'])
  await setStepGlazes('e1', [{ glazeId: 'B' }, { glazeId: 'A' }])
  const apps = await live()
  expect(apps.map((a) => a.id).sort()).toEqual(['a0', 'a1'])
  expect(apps.map((a) => a.glazeId)).toEqual(['B', 'A'])
  expect(await db.glazeApps.count()).toBe(2)
})

test('removing a glaze soft-deletes the extra row', async () => {
  await seed('glazed', ['A', 'B'])
  await setStepGlazes('e1', [{ glazeId: 'A' }])
  expect(await live()).toHaveLength(1)
  expect((await db.glazeApps.get('a1'))?.deletedAt).toBeTruthy()
})

test('an empty list clears every glaze', async () => {
  await seed('glazed', ['A', 'B'])
  expect(await setStepGlazes('e1', [])).toBe(true)
  expect(await live()).toHaveLength(0)
})

test('saving the same glazes changes nothing and returns false', async () => {
  await seed('glazed', ['A', 'B'])
  const before = await db.glazeApps.toArray()
  const piece = await db.pieces.get('p1')
  expect(await setStepGlazes('e1', [{ glazeId: 'A' }, { glazeId: 'B' }])).toBe(
    false,
  )
  expect(await db.glazeApps.toArray()).toEqual(before)
  expect((await db.pieces.get('p1'))?.updatedAt).toBe(piece?.updatedAt)
})

test('throws for a step that is not Glazed', async () => {
  await seed('bisqued', [])
  await expect(setStepGlazes('e1', [{ glazeId: 'A' }])).rejects.toThrow(
    'Step not found',
  )
})

const photo = (hash: string): ProcessedImage => ({
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash,
  width: 10,
  height: 20,
  takenAt: '2026-10-31T09:00:00.000Z',
})

const D1 = '2026-03-01T00:00:00.000Z'

test('saves note and date, and clears them', async () => {
  await seed('trimmed', [])
  await saveStepDetails({
    entryId: 'e1',
    note: '  nice  ',
    date: '2026-03-05',
  })
  const saved = await db.entries.get('e1')
  expect(saved?.note).toBe('nice')
  expect(saved?.date).toBe(new Date('2026-03-05').toISOString())
  await saveStepDetails({ entryId: 'e1', note: '  ', date: undefined })
  const cleared = await db.entries.get('e1')
  expect(cleared?.note).toBeUndefined()
  expect(cleared?.date).toBeUndefined()
})

test('rejects a missing step', async () => {
  await expect(
    saveStepDetails({ entryId: 'nope', note: '', date: undefined }),
  ).rejects.toThrow('Step not found')
})

async function seedWithPhoto(): Promise<string> {
  await seed('glazed', [])
  const { storePhoto } = await import('../photos/store')
  const id = await db.transaction('rw', db.photos, db.photoBytes, () =>
    storePhoto(photo('old')),
  )
  await db.entries.update('e1', { photoId: id, date: D1 })
  return id
}

test('swapping a photo returns the swap and sends the old photo to Recently Deleted', async () => {
  const oldId = await seedWithPhoto()
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: D1,
    photo: photo('new'),
  })
  const entry = await db.entries.get('e1')
  expect(entry?.photoId).not.toBe(oldId)
  expect(swap).toEqual({
    entryId: 'e1',
    oldPhotoId: oldId,
    newPhotoId: entry?.photoId,
    oldDate: D1,
  })
  const old = await db.photos.get(oldId)
  expect(old?.deletedAt).toBeTruthy()
  expect(old?.lastEntryId).toBe('e1')
  expect(old?.lastPieceId).toBe('p1')
  expect(old?.lastStage).toBe('glazed')
})

test('a photo on a step that had none is not a swap', async () => {
  await seed('trimmed', [])
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: undefined,
    photo: photo('new'),
  })
  expect(swap).toBeUndefined()
  expect((await db.entries.get('e1'))?.photoId).toBeTruthy()
})

test('choosing the same image again is not a swap', async () => {
  const oldId = await seedWithPhoto()
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: D1,
    photo: photo('old'),
  })
  expect(swap).toBeUndefined()
  expect((await db.entries.get('e1'))?.photoId).toBe(oldId)
  expect((await db.photos.get(oldId))?.deletedAt).toBeUndefined()
})

test('a swapped-out photo shown on another live step stays live', async () => {
  const oldId = await seedWithPhoto()
  await db.entries.add({
    id: 'e2',
    pieceId: 'p1',
    stage: 'trimmed',
    photoId: oldId,
  })
  await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: D1,
    photo: photo('new'),
  })
  expect((await db.photos.get(oldId))?.deletedAt).toBeUndefined()
  expect((await db.entries.get('e2'))?.photoId).toBe(oldId)
})

test('glazes are saved only on a Glazed step', async () => {
  await seed('bisqued', [])
  await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: undefined,
    glazes: [{ glazeId: 'A' }],
  })
  expect(await db.glazeApps.count()).toBe(0)
  await db.entries.add({ id: 'e3', pieceId: 'p1', stage: 'glazed' })
  await saveStepDetails({
    entryId: 'e3',
    note: '',
    date: undefined,
    glazes: [{ glazeId: 'A' }],
  })
  expect(await db.glazeApps.count()).toBe(1)
})

test('changing the earliest date moves the piece start date', async () => {
  await seed('trimmed', [])
  await saveStepDetails({ entryId: 'e1', note: '', date: '2026-02-01' })
  expect((await db.pieces.get('p1'))?.createdAt).toBe(
    new Date('2026-02-01').toISOString(),
  )
})

test('a failed write leaves nothing changed', async () => {
  const oldId = await seedWithPhoto()
  await db.entries.update('e1', { note: 'before' })
  const spy = vi
    .spyOn(db.glazeApps, 'add')
    .mockRejectedValue(new Error('storage full'))
  const bulk = vi
    .spyOn(db.glazeApps, 'bulkAdd')
    .mockRejectedValue(new Error('storage full'))
  await expect(
    saveStepDetails({
      entryId: 'e1',
      note: 'after',
      date: D1,
      photo: photo('new'),
      glazes: [{ glazeId: 'A' }],
    }),
  ).rejects.toThrow()
  spy.mockRestore()
  bulk.mockRestore()
  const entry = await db.entries.get('e1')
  expect(entry?.note).toBe('before')
  expect(entry?.photoId).toBe(oldId)
  expect((await db.photos.get(oldId))?.deletedAt).toBeUndefined()
  expect(await db.photos.count()).toBe(1)
})

async function swapped() {
  const oldId = await seedWithPhoto()
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: '2026-04-01',
    photo: photo('new'),
  })
  if (!swap) throw new Error('expected a swap')
  return { oldId, swap }
}

test('undo puts the old photo and date back and sends the new photo to Recently Deleted', async () => {
  const { oldId, swap } = await swapped()
  expect(await undoPhotoSwap(swap)).toBe(true)
  const entry = await db.entries.get('e1')
  expect(entry?.photoId).toBe(oldId)
  expect(entry?.date).toBe(D1)
  expect((await db.photos.get(oldId))?.deletedAt).toBeUndefined()
  const fresh = await db.photos.get(swap.newPhotoId)
  expect(fresh?.deletedAt).toBeTruthy()
  expect(fresh?.lastEntryId).toBe('e1')
})

test('undo keeps a note saved in the same save', async () => {
  await seedWithPhoto()
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: 'keep me',
    date: D1,
    photo: photo('new'),
  })
  if (!swap) throw new Error('expected a swap')
  await undoPhotoSwap(swap)
  expect((await db.entries.get('e1'))?.note).toBe('keep me')
})

test('undo does nothing once the step shows another photo', async () => {
  const { swap } = await swapped()
  await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: D1,
    photo: photo('third'),
  })
  const before = await db.entries.get('e1')
  const photos = await db.photos.toArray()
  expect(await undoPhotoSwap(swap)).toBe(false)
  expect(await db.entries.get('e1')).toEqual(before)
  expect(await db.photos.toArray()).toEqual(photos)
})

test('undo does nothing for a deleted step', async () => {
  const { swap } = await swapped()
  await db.entries.update('e1', { deletedAt: '2026-05-01T00:00:00.000Z' })
  const photos = await db.photos.toArray()
  expect(await undoPhotoSwap(swap)).toBe(false)
  expect((await db.entries.get('e1'))?.photoId).toBe(swap.newPhotoId)
  expect(await db.photos.toArray()).toEqual(photos)
})

test('undo leaves a new photo that another live step shows', async () => {
  const { swap } = await swapped()
  await db.entries.add({
    id: 'e2',
    pieceId: 'p1',
    stage: 'trimmed',
    photoId: swap.newPhotoId,
  })
  expect(await undoPhotoSwap(swap)).toBe(true)
  expect((await db.photos.get(swap.newPhotoId))?.deletedAt).toBeUndefined()
})

test('undo relinks an old photo that another step kept live', async () => {
  const oldId = await seedWithPhoto()
  await db.entries.add({
    id: 'e2',
    pieceId: 'p1',
    stage: 'trimmed',
    photoId: oldId,
  })
  const swap = await saveStepDetails({
    entryId: 'e1',
    note: '',
    date: D1,
    photo: photo('new'),
  })
  if (!swap) throw new Error('expected a swap')
  expect(await undoPhotoSwap(swap)).toBe(true)
  expect((await db.entries.get('e1'))?.photoId).toBe(oldId)
  expect((await db.photos.get(oldId))?.deletedAt).toBeUndefined()
})

test('undo does nothing when the old photo was purged', async () => {
  const { oldId, swap } = await swapped()
  await db.photos.update(oldId, { purgedAt: '2026-05-01T00:00:00.000Z' })
  expect(await undoPhotoSwap(swap)).toBe(false)
  expect((await db.entries.get('e1'))?.photoId).toBe(swap.newPhotoId)
})

test('addPhotoToStep dates an undated step from the photo', async () => {
  await seed('trimmed', [])
  await addPhotoToStep('e1', photo('new'))
  const entry = await db.entries.get('e1')
  expect(entry?.photoId).toBeTruthy()
  expect(entry?.date).toBe('2026-10-31T09:00:00.000Z')
  expect((await db.pieces.get('p1'))?.createdAt).toBe(
    '2026-10-31T09:00:00.000Z',
  )
})

test('addPhotoToStep keeps a date the step already has', async () => {
  await seed('trimmed', [])
  await db.entries.update('e1', { date: D1 })
  await addPhotoToStep('e1', photo('new'))
  expect((await db.entries.get('e1'))?.date).toBe(D1)
  expect((await db.entries.get('e1'))?.photoId).toBeTruthy()
})

test('addPhotoToStep refuses a step that has a photo', async () => {
  await seedWithPhoto()
  await expect(addPhotoToStep('e1', photo('new'))).rejects.toThrow(
    'Step has a photo',
  )
  await expect(addPhotoToStep('nope', photo('new'))).rejects.toThrow(
    'Step not found',
  )
})
