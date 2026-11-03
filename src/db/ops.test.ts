import type { ProcessedImage } from '../photos/process'
import { db } from './db'
import {
  addStageEntry,
  createPiece,
  defaultNoteFor,
  ensureDefaults,
  removePhoto,
  softDelete,
  upsertClay,
} from './ops'
import { currentStage } from './stage'
import type { Settings } from './types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const settings: Settings = {
  id: 'app',
  defaultCone: '6',
  bisqueNote: 'Cone 6',
  firedNote: 'Cone 6 oxidation',
}

test('ensureDefaults is idempotent: one clay, one settings row after two calls', async () => {
  await ensureDefaults()
  await ensureDefaults()
  const clays = await db.clays.toArray()
  expect(clays).toHaveLength(1)
  expect(clays[0].name).toBe('White stoneware')
  expect(await db.settings.count()).toBe(1)
  const row = await db.settings.get('app')
  expect(row).toMatchObject({
    defaultClayId: clays[0].id,
    defaultCone: '6',
    bisqueNote: 'Cone 6',
    firedNote: 'Cone 6 oxidation',
  })
})

test('createPiece writes piece + thrown entry; currentStage is thrown', async () => {
  const start = new Date().toISOString()
  const date = '2026-11-01T10:00:00.000Z'
  const id = await createPiece({ name: 'Mug', form: 'mug', date })
  const piece = await db.pieces.get(id)
  expect(piece).toMatchObject({ name: 'Mug', createdAt: date })
  const updatedAt = piece?.updatedAt as string
  expect(new Date(updatedAt).toISOString()).toBe(updatedAt)
  expect(updatedAt >= start).toBe(true)
  const entries = await db.entries.where('pieceId').equals(id).toArray()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ stage: 'thrown', date })
  expect(currentStage(entries)).toBe('thrown')
})

test('addStageEntry glazed writes GlazeApplication rows in order 0,1 and bumps updatedAt', async () => {
  const pieceId = await createPiece({ date: '2026-01-01T00:00:00.000Z' })
  const before = '2026-01-01T00:00:00.000Z'
  await db.pieces.update(pieceId, { updatedAt: before })
  const entryId = await addStageEntry({
    pieceId,
    stage: 'glazed',
    glazes: [
      { glazeId: 'g1', dips: 2, method: 'dip' },
      { glazeId: 'g2', note: 'rim' },
    ],
  })
  const apps = (
    await db.glazeApps.where('entryId').equals(entryId).toArray()
  ).sort((a, b) => a.order - b.order)
  expect(apps.map((a) => [a.glazeId, a.order, a.pieceId])).toEqual([
    ['g1', 0, pieceId],
    ['g2', 1, pieceId],
  ])
  const after = (await db.pieces.get(pieceId))?.updatedAt as string
  expect(after > before).toBe(true)
})

test('addStageEntry rolls back the entry when the glazeApps write throws', async () => {
  const pieceId = await createPiece({})
  const before = await db.entries.count()
  vi.spyOn(db.glazeApps, 'bulkAdd').mockRejectedValue(new Error('boom'))
  await expect(
    addStageEntry({ pieceId, stage: 'glazed', glazes: [{ glazeId: 'g1' }] }),
  ).rejects.toThrow()
  expect(await db.entries.count()).toBe(before)
})

const photo = (hash: string): ProcessedImage => ({
  blob: new Blob(['full']),
  thumb: new Blob(['thumb']),
  hash,
  width: 10,
  height: 20,
  takenAt: '2026-10-31T09:00:00.000Z',
})

test('createPiece with a photo stores it, links photoId and dates from takenAt', async () => {
  const id = await createPiece({ photo: photo('h1') })
  const [entry] = await db.entries.where('pieceId').equals(id).toArray()
  expect(entry.date).toBe('2026-10-31T09:00:00.000Z')
  expect((await db.pieces.get(id))?.createdAt).toBe(entry.date)
  expect(entry.photoId).toBeTruthy()
  const stored = await db.photos.get(entry.photoId as string)
  expect(stored?.hash).toBe('h1')
  expect(await db.photos.count()).toBe(1)
})

test('addStageEntry with a photo rolls back entry and photo when glazeApps throws', async () => {
  const pieceId = await createPiece({})
  const entries = await db.entries.count()
  vi.spyOn(db.glazeApps, 'bulkAdd').mockRejectedValue(new Error('boom'))
  await expect(
    addStageEntry({
      pieceId,
      stage: 'glazed',
      photo: photo('h2'),
      glazes: [{ glazeId: 'g1' }],
    }),
  ).rejects.toThrow()
  expect(await db.entries.count()).toBe(entries)
  expect(await db.photos.count()).toBe(0)
})

test('addStageEntry for a nonexistent piece rejects and writes nothing', async () => {
  await expect(
    addStageEntry({ pieceId: 'nope', stage: 'trimmed', photo: photo('h3') }),
  ).rejects.toThrow('Piece not found')
  expect(await db.entries.count()).toBe(0)
  expect(await db.photos.count()).toBe(0)
})

test('addStageEntry rejects a soft-deleted piece and writes nothing', async () => {
  const pieceId = await createPiece({})
  await softDelete('pieces', pieceId)
  const deleted = await db.pieces.get(pieceId)
  await expect(
    addStageEntry({ pieceId, stage: 'trimmed', photo: photo('h4') }),
  ).rejects.toThrow('Piece not found')
  expect(await db.entries.count()).toBe(1)
  expect(await db.photos.count()).toBe(0)
  expect((await db.pieces.get(pieceId))?.updatedAt).toBe(deleted?.updatedAt)
})

test('dates are stored as full ISO timestamps so a date-only value orders correctly', async () => {
  const pieceId = await createPiece({ date: '2026-11-02' })
  expect((await db.pieces.get(pieceId))?.createdAt).toBe(
    '2026-11-02T00:00:00.000Z',
  )
  const entryId = await addStageEntry({
    pieceId,
    stage: 'trimmed',
    date: '2026-11-03',
  })
  expect((await db.entries.get(entryId))?.date).toBe('2026-11-03T00:00:00.000Z')
})

test('an invalid date is rejected', async () => {
  await expect(createPiece({ date: 'not a date' })).rejects.toThrow(
    'Invalid date',
  )
  const pieceId = await createPiece({})
  await expect(
    addStageEntry({ pieceId, stage: 'trimmed', date: '2026-13-45' }),
  ).rejects.toThrow('Invalid date')
  expect(await db.entries.count()).toBe(1)
})

test('removePhoto unlinks a shared photo from one entry and keeps it for the other', async () => {
  const pieceId = await createPiece({ photo: photo('shared') })
  const trimmedId = await addStageEntry({
    pieceId,
    stage: 'trimmed',
    photo: photo('shared'),
  })
  const [thrown] = await db.entries
    .where('pieceId')
    .equals(pieceId)
    .filter((e) => e.stage === 'thrown')
    .toArray()
  const photoId = thrown.photoId as string
  expect((await db.entries.get(trimmedId))?.photoId).toBe(photoId)

  await removePhoto(trimmedId)
  expect((await db.entries.get(trimmedId))?.photoId).toBeUndefined()
  expect((await db.entries.get(thrown.id))?.photoId).toBe(photoId)
  expect((await db.photos.get(photoId))?.deletedAt).toBeUndefined()

  await removePhoto(thrown.id)
  expect((await db.entries.get(thrown.id))?.photoId).toBeUndefined()
  expect((await db.photos.get(photoId))?.deletedAt).toBeTruthy()
})

test('removePhoto ignores references from deleted entries', async () => {
  const pieceId = await createPiece({ photo: photo('solo') })
  const otherId = await addStageEntry({
    pieceId,
    stage: 'trimmed',
    photo: photo('solo'),
  })
  await softDelete('entries', otherId)
  const [thrown] = await db.entries
    .where('pieceId')
    .equals(pieceId)
    .filter((e) => e.stage === 'thrown')
    .toArray()
  await removePhoto(thrown.id)
  expect(
    (await db.photos.get(thrown.photoId as string))?.deletedAt,
  ).toBeTruthy()
})

test('upsertClay rejects a blank name', async () => {
  await expect(upsertClay('   ')).rejects.toThrow('Clay name is required')
  expect(await db.clays.count()).toBe(0)
})

test('softDelete sets deletedAt and filtered queries exclude it', async () => {
  const id = await createPiece({})
  await softDelete('pieces', id)
  expect((await db.pieces.get(id))?.deletedAt).toBeTruthy()
  expect(await db.pieces.filter((p) => !p.deletedAt).toArray()).toHaveLength(0)
})

test('upsertClay("white STONEWARE") returns the existing id', async () => {
  await ensureDefaults()
  const existing = (await db.clays.toArray())[0]
  expect(await upsertClay('white STONEWARE')).toBe(existing.id)
  expect(await db.clays.count()).toBe(1)
  const other = await upsertClay('  Porcelain ')
  expect(other).not.toBe(existing.id)
  expect((await db.clays.get(other))?.name).toBe('Porcelain')
})

test('defaultNoteFor bisqued/fired/thrown', () => {
  expect(defaultNoteFor('bisqued', settings)).toBe('Cone 6')
  expect(defaultNoteFor('fired', settings)).toBe('Cone 6 oxidation')
  expect(defaultNoteFor('thrown', settings)).toBe('')
})
