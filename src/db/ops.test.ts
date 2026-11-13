import type { ProcessedImage } from '../photos/process'
import { setSinkForTests, type TelemetrySink } from '../telemetry/telemetry'
import { db, UNDELETE_PHOTO } from './db'
import {
  addGlazesToPiece,
  addStageEntry,
  createPiece,
  defaultNoteFor,
  ensureDefaults,
  removePhoto,
  restagePiece,
  setEntryDate,
  setStudioName,
  softDelete,
  updatePiece,
  upsertClay,
} from './ops'
import { currentStage, STAGES } from './stage'
import type { Settings } from './types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
  setSinkForTests(undefined)
})

function captureEvents() {
  const events: Array<[string, Record<string, unknown>]> = []
  const sink: TelemetrySink = {
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  }
  setSinkForTests(sink)
  return events
}

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
  expect(await db.photoBytes.count()).toBe(0)
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

test('removing a photo from a step remembers where it was', async () => {
  const pieceId = await createPiece({ photo: photo('h1') })
  const [entry] = await db.entries.where('pieceId').equals(pieceId).toArray()
  const photoId = entry.photoId as string

  await removePhoto(entry.id)

  const row = await db.photos.get(photoId)
  expect(row?.deletedAt).toBeTruthy()
  expect(row).toMatchObject({
    lastPieceId: pieceId,
    lastEntryId: entry.id,
    lastStage: entry.stage,
  })
})

test('undeleting a photo clears everything removing it set', async () => {
  const pieceId = await createPiece({ photo: photo('h1') })
  const [entry] = await db.entries.where('pieceId').equals(pieceId).toArray()
  const photoId = entry.photoId as string
  // Sync marks move on with every write; the rest must come back as it was.
  const { updatedAt, dirty, ...before } = (await db.photos.get(photoId)) ?? {}

  await removePhoto(entry.id)
  await db.photos.update(photoId, { ...UNDELETE_PHOTO })

  const {
    updatedAt: _u,
    dirty: _d,
    ...after
  } = (await db.photos.get(photoId)) ?? {}
  expect(after).toEqual(before)
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

const liveByStage = async (pieceId: string) =>
  (await db.entries.where('pieceId').equals(pieceId).toArray())
    .filter((e) => !e.deletedAt)
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage))

test('addStageEntry Thrown→Bisqued fills Trimmed with no photo, date or note', async () => {
  const pieceId = await createPiece({ date: '2026-11-01T10:00:00.000Z' })
  await addStageEntry({
    pieceId,
    stage: 'bisqued',
    date: '2026-11-03T10:00:00.000Z',
  })
  const entries = await liveByStage(pieceId)
  expect(entries.map((e) => e.stage)).toEqual(['thrown', 'trimmed', 'bisqued'])
  expect(entries[0].date).toBe('2026-11-01T10:00:00.000Z')
  expect(entries[1].photoId).toBeUndefined()
  expect(entries[1].date).toBeUndefined()
  expect(entries[1].note).toBeUndefined()
  expect(entries[2].date).toBe('2026-11-03T10:00:00.000Z')
})

test('addStageEntry with no photo and no date stores no date', async () => {
  const pieceId = await createPiece({})
  const id = await addStageEntry({ pieceId, stage: 'trimmed' })
  const row = (await db.entries.get(id)) as object
  expect('date' in row).toBe(false)
})

test('addStageEntry Bisqued→Fired puts glazes on the filled Glazed step', async () => {
  const pieceId = await createPiece({ stage: 'bisqued' })
  const firedId = await addStageEntry({
    pieceId,
    stage: 'fired',
    glazes: [{ glazeId: 'g1' }],
  })
  const glazed = (await liveByStage(pieceId)).find((e) => e.stage === 'glazed')
  const apps = await db.glazeApps.toArray()
  expect(apps).toHaveLength(1)
  expect(apps[0].entryId).toBe(glazed?.id)
  expect(await db.glazeApps.where('entryId').equals(firedId).count()).toBe(0)
})

test('addStageEntry at the current stage of a Fired piece fills nothing', async () => {
  const pieceId = await createPiece({ stage: 'fired' })
  expect(await db.entries.count()).toBe(5)
  await addStageEntry({ pieceId, stage: 'fired' })
  expect(await db.entries.count()).toBe(6)
})

test('addStageEntry does not refill a deleted step behind the current stage', async () => {
  const pieceId = await createPiece({ stage: 'bisqued' })
  const trimmed = (await liveByStage(pieceId)).find(
    (e) => e.stage === 'trimmed',
  )
  await softDelete('entries', trimmed?.id as string)
  await addStageEntry({ pieceId, stage: 'glazed' })
  const all = await db.entries.where('pieceId').equals(pieceId).toArray()
  expect(all.filter((e) => e.stage === 'trimmed')).toHaveLength(1)
  expect(all).toHaveLength(4)
})

test('createPiece at Bisqued with a photo writes Thrown and Trimmed undated, photo on Bisqued', async () => {
  const id = await createPiece({
    photo: photo('c1'),
    stage: 'bisqued',
    note: 'n',
  })
  const [thrown, trimmed, bisqued] = await liveByStage(id)
  expect(thrown.date).toBeUndefined()
  expect(trimmed.date).toBeUndefined()
  expect(thrown.photoId).toBeUndefined()
  expect(bisqued.photoId).toBeTruthy()
  expect(bisqued.note).toBe('n')
  expect(bisqued.date).toBe('2026-10-31T09:00:00.000Z')
  expect((await db.pieces.get(id))?.createdAt).toBe(bisqued.date)
})

test('createPiece with no photo at Glazed: all four steps undated, glazes on Glazed', async () => {
  const id = await createPiece({ stage: 'glazed', glazes: [{ glazeId: 'g1' }] })
  const entries = await liveByStage(id)
  expect(entries.map((e) => e.stage)).toEqual([
    'thrown',
    'trimmed',
    'bisqued',
    'glazed',
  ])
  expect(entries.every((e) => e.date === undefined)).toBe(true)
  const apps = await db.glazeApps.toArray()
  expect(apps.map((a) => a.entryId)).toEqual([entries[3].id])
})

test('restagePiece Glazed→Thrown→Bisqued leaves one live step per stage, photo on Bisqued', async () => {
  const id = await createPiece({
    photo: photo('r1'),
    stage: 'glazed',
    glazes: [{ glazeId: 'g1' }],
  })
  await restagePiece(id, 'thrown')
  let entries = await liveByStage(id)
  expect(entries.map((e) => e.stage)).toEqual(['thrown'])
  expect(entries[0].photoId).toBeTruthy()
  const apps = await db.glazeApps.toArray()
  expect(apps).toHaveLength(1)
  expect(apps[0].deletedAt).toBeDefined()
  await restagePiece(id, 'bisqued')
  entries = await liveByStage(id)
  expect(entries.map((e) => e.stage)).toEqual(['thrown', 'trimmed', 'bisqued'])
  expect(entries[2].photoId).toBeTruthy()
  expect(entries[0].photoId).toBeUndefined()
})

test('addGlazesToPiece attaches to the Glazed step and ignores empty or missing', async () => {
  const id = await createPiece({ stage: 'glazed' })
  await addGlazesToPiece(id, [])
  expect(await db.glazeApps.count()).toBe(0)
  await addGlazesToPiece(id, [{ glazeId: 'g1' }])
  await addGlazesToPiece(id, [{ glazeId: 'g2' }])
  const apps = (await db.glazeApps.toArray()).sort((a, b) => a.order - b.order)
  expect(apps.map((a) => [a.glazeId, a.order])).toEqual([
    ['g1', 0],
    ['g2', 1],
  ])
  const other = await createPiece({ stage: 'bisqued' })
  await addGlazesToPiece(other, [{ glazeId: 'g3' }])
  expect(await db.glazeApps.count()).toBe(2)
})

test('addGlazesToPiece adds to the glaze step, not a later bare Glazed step', async () => {
  const id = await createPiece({
    stage: 'glazed',
    date: '2026-10-01T12:00:00.000Z',
    glazes: [{ glazeId: 'g1' }],
  })
  const bare = await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    date: '2026-10-03T12:00:00.000Z',
  })
  const [withLayers] = (await db.glazeApps.toArray()).map((a) => a.entryId)
  await addGlazesToPiece(id, [{ glazeId: 'g2' }])
  const live = (await db.glazeApps.toArray())
    .filter((a) => !a.deletedAt)
    .sort((a, b) => a.order - b.order)
  expect(live.map((a) => [a.entryId, a.glazeId, a.order])).toEqual([
    [withLayers, 'g1', 0],
    [withLayers, 'g2', 1],
  ])
  expect(live.some((a) => a.entryId === bare)).toBe(false)
})

test('addGlazesToPiece ignores deleted layers', async () => {
  const id = await createPiece({
    photo: photo('dl'),
    stage: 'glazed',
    glazes: [{ glazeId: 'g1' }, { glazeId: 'g2' }],
  })
  // Leaving Glazed tombstones the step's layers; coming back keeps them gone.
  await restagePiece(id, 'bisqued')
  await restagePiece(id, 'glazed')
  await addGlazesToPiece(id, [{ glazeId: 'g3' }])
  const live = (await db.glazeApps.toArray()).filter((a) => !a.deletedAt)
  expect(live.map((a) => [a.glazeId, a.order])).toEqual([['g3', 0]])
  expect(await db.glazeApps.count()).toBe(3)
})

test('ensureDefaults writes quietly', async () => {
  await ensureDefaults()
  const [clay] = await db.clays.toArray()
  const row = await db.settings.get('app')
  expect(clay.name).toBe('White stoneware')
  expect(row?.defaultClayId).toBe(clay.id)
  for (const r of [clay, row]) {
    expect(r).not.toHaveProperty('updatedAt')
    expect(r).not.toHaveProperty('dirty')
  }
})

test('setEntryDate sets, then clears, the date', async () => {
  const id = await createPiece({})
  const [entry] = await liveByStage(id)
  await db.pieces.update(id, { updatedAt: '2026-01-01T00:00:00.000Z' })
  await setEntryDate(entry.id, '2026-11-03')
  expect((await db.entries.get(entry.id))?.date).toBe(
    '2026-11-03T00:00:00.000Z',
  )
  expect(((await db.pieces.get(id))?.updatedAt as string) > '2026-01-01').toBe(
    true,
  )
  await setEntryDate(entry.id, undefined)
  expect('date' in ((await db.entries.get(entry.id)) as object)).toBe(false)
})

test("setEntryDate leaves the piece's createdAt alone; Day N reads the steps", async () => {
  const id = await createPiece({ date: '2026-10-08T12:00:00Z' })
  const [thrown] = await liveByStage(id)
  await setEntryDate(thrown.id, '2026-10-01T12:00:00.000Z')
  expect((await db.pieces.get(id))?.createdAt).toBe('2026-10-08T12:00:00.000Z')
})

test('restagePiece never removes rows', async () => {
  const id = await createPiece({
    stage: 'fired',
    glazes: [{ glazeId: 'g1' }, { glazeId: 'g2' }],
  })
  const glazedId = (await liveByStage(id)).find((e) => e.stage === 'glazed')
    ?.id as string
  let entryCount = await db.entries.count()
  let appCount = await db.glazeApps.count()
  expect(appCount).toBe(2)
  for (const stage of ['thrown', 'fired', 'thrown'] as const) {
    await restagePiece(id, stage)
    const entries = await db.entries.count()
    const apps = await db.glazeApps.count()
    expect(entries).toBeGreaterThanOrEqual(entryCount)
    expect(apps).toBeGreaterThanOrEqual(appCount)
    entryCount = entries
    appCount = apps
  }
  // The blank steps, and the Glazed step's layers, are tombstones now.
  const all = await db.entries.where('pieceId').equals(id).toArray()
  expect(all.filter((e) => !e.deletedAt).map((e) => e.stage)).toEqual([
    'thrown',
  ])
  expect(all.find((e) => e.id === glazedId)?.deletedAt).toBeDefined()
  const layers = await db.glazeApps.where('entryId').equals(glazedId).toArray()
  expect(layers).toHaveLength(2)
  expect(layers.every((a) => a.deletedAt)).toBe(true)
  await restagePiece(id, 'fired')
  const after = await liveByStage(id)
  expect(after.map((e) => e.stage)).toEqual([
    'thrown',
    'trimmed',
    'bisqued',
    'glazed',
    'fired',
  ])
})

test('restagePiece soft-deletes a removed step that has a note', async () => {
  const id = await createPiece({ stage: 'fired' })
  const glazed = (await liveByStage(id)).find((e) => e.stage === 'glazed')
  await db.entries.update(glazed?.id as string, { note: 'keep me' })
  await restagePiece(id, 'thrown')
  const row = await db.entries.get(glazed?.id as string)
  expect(row?.deletedAt).toBeDefined()
})

test('setStudioName stores the trimmed name; a blank name removes it', async () => {
  await ensureDefaults()
  await setStudioName('  Penguin Foot ')
  expect((await db.settings.get('app'))?.studioName).toBe('Penguin Foot')
  await setStudioName('   ')
  const row = await db.settings.get('app')
  expect(row && 'studioName' in row).toBe(false)
})

test('updatePiece on a soft-deleted piece leaves it untouched', async () => {
  const id = await createPiece({ name: 'Mug' })
  await softDelete('pieces', id)
  const before = await db.pieces.get(id)
  await new Promise((r) => setTimeout(r, 5))
  await updatePiece(id, { notes: 'late flush' })
  expect(await db.pieces.get(id)).toEqual(before)
})

test('updatePiece on a missing piece resolves and creates nothing', async () => {
  await updatePiece('nope', { notes: 'x' })
  expect(await db.pieces.get('nope')).toBeUndefined()
})

test('createPiece reports piece_logged', async () => {
  const events = captureEvents()
  await createPiece({ photo: photo('t1') })
  expect(events).toHaveLength(1)
  expect(events[0][0]).toBe('piece_logged')
  expect(events[0][1]).toMatchObject({ has_photo: true, stage: 'thrown' })
  expect(typeof events[0][1].ms).toBe('number')
})

test('createPiece with holdReport sends nothing until released', async () => {
  const events = captureEvents()
  await createPiece({ photo: photo('t2'), holdReport: true })
  expect(events).toEqual([])
})

test('addStageEntry reports stage_added', async () => {
  const id = await createPiece({})
  const events = captureEvents()
  await addStageEntry({ pieceId: id, stage: 'trimmed' })
  expect(events).toHaveLength(1)
  expect(events[0][0]).toBe('stage_added')
  expect(events[0][1]).toMatchObject({ stage: 'trimmed', has_photo: false })
  expect(typeof events[0][1].ms).toBe('number')
})

test('addGlazesToPiece reports glazes_added only when it adds', async () => {
  await db.glazes.add({ id: 'g1', name: 'Oatmeal', color: '#D8C7A6' })
  const noGlazed = await createPiece({})
  const glazed = await createPiece({ stage: 'glazed' })
  const events = captureEvents()
  await addGlazesToPiece(glazed, [])
  await addGlazesToPiece(noGlazed, [{ glazeId: 'g1' }])
  expect(events).toEqual([])
  await addGlazesToPiece(glazed, [{ glazeId: 'g1' }, { glazeId: 'g1' }])
  expect(events).toEqual([['glazes_added', { layers: 2 }]])
})

test('createPiece reports glazes_added when it writes glaze rows', async () => {
  await db.glazes.add({ id: 'g1', name: 'Oatmeal', color: '#D8C7A6' })
  const events = captureEvents()
  await createPiece({ stage: 'glazed', glazes: [{ glazeId: 'g1' }] })
  expect(events.map(([n]) => n)).toEqual(['glazes_added', 'piece_logged'])
  expect(events[0][1]).toEqual({ layers: 1 })
})

test('addStageEntry reports glazes_added when it writes glaze rows', async () => {
  await db.glazes.add({ id: 'g1', name: 'Oatmeal', color: '#D8C7A6' })
  const id = await createPiece({})
  const events = captureEvents()
  await addStageEntry({
    pieceId: id,
    stage: 'glazed',
    glazes: [{ glazeId: 'g1' }, { glazeId: 'g1' }],
  })
  expect(events.map(([n]) => n)).toEqual(['glazes_added', 'stage_added'])
  expect(events[0][1]).toEqual({ layers: 2 })
})

test('nested in an outer transaction, ops report only after it commits', async () => {
  await db.glazes.add({ id: 'g1', name: 'Oatmeal', color: '#D8C7A6' })
  const id = await createPiece({})
  const events = captureEvents()
  await db.transaction(
    'rw',
    db.pieces,
    db.entries,
    db.glazeApps,
    db.photos,
    db.photoBytes,
    async () => {
      await createPiece({ stage: 'glazed', glazes: [{ glazeId: 'g1' }] })
      await addStageEntry({ pieceId: id, stage: 'trimmed' })
      expect(events).toEqual([])
    },
  )
  expect(events.map(([n]) => n).sort()).toEqual([
    'glazes_added',
    'piece_logged',
    'stage_added',
  ])
})

test('nested in an outer transaction that aborts, ops report nothing', async () => {
  const id = await createPiece({})
  const events = captureEvents()
  await expect(
    db.transaction(
      'rw',
      db.pieces,
      db.entries,
      db.glazeApps,
      db.photos,
      db.photoBytes,
      async () => {
        await addStageEntry({ pieceId: id, stage: 'trimmed' })
        throw new Error('abort')
      },
    ),
  ).rejects.toThrow('abort')
  expect(events).toEqual([])
})

test('addGlazesToPiece nested in an outer transaction reports only after commit, and not on abort', async () => {
  await db.glazes.add({ id: 'g1', name: 'Oatmeal', color: '#D8C7A6' })
  const id = await createPiece({ stage: 'glazed', glazes: [{ glazeId: 'g1' }] })
  const tables = [db.pieces, db.entries, db.glazeApps] as const
  const events = captureEvents()
  await db.transaction('rw', ...tables, async () => {
    await addGlazesToPiece(id, [{ glazeId: 'g1' }])
    expect(events).toEqual([])
  })
  expect(events).toEqual([['glazes_added', { layers: 1 }]])

  events.length = 0
  await expect(
    db.transaction('rw', ...tables, async () => {
      await addGlazesToPiece(id, [{ glazeId: 'g1' }])
      throw new Error('abort')
    }),
  ).rejects.toThrow('abort')
  expect(events).toEqual([])
})

test("a throwing sink doesn't break createPiece", async () => {
  setSinkForTests({
    capture: () => {
      throw new Error('sink down')
    },
    identify: () => {},
    reset: () => {},
    register: () => {},
    captureException: () => {},
  })
  const id = await createPiece({ name: 'Mug' })
  expect(await db.pieces.get(id)).toBeDefined()
})

test('a failed createPiece reports nothing', async () => {
  const events = captureEvents()
  vi.spyOn(db.entries, 'bulkAdd').mockRejectedValue(new Error('boom'))
  await expect(createPiece({})).rejects.toThrow()
  expect(events).toEqual([])
})
