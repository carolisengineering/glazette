import 'fake-indexeddb/auto'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db } from '../db/db'
import { createPiece, ensureDefaults, softDelete } from '../db/ops'
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import type { Glaze, Photo, Piece, Settings, StageEntry } from '../db/types'
import { lenientBytes } from '../test/bytes'
import { exportZip as exportStrict } from './export'
import type { BackupJson, PhotoMeta } from './format'
import {
  importZip as importStrict,
  NewerBackupError,
  NotABackupError,
} from './import'

const exportZip = () => exportStrict(new Date(), lenientBytes)
const importZip = (file: Blob) => importStrict(file, lenientBytes)

const SETTINGS: Settings = {
  id: 'app',
  defaultClayId: 'c1',
  defaultCone: '10',
  bisqueNote: 'Cone 04',
  firedNote: 'Cone 10 reduction',
  studioName: 'Penguin Foot',
}

function backup(over: Partial<BackupJson> = {}): BackupJson {
  return {
    version: 1,
    exportedAt: '2026-11-05T12:00:00.000Z',
    pieces: [],
    entries: [],
    glazeApps: [],
    glazes: [],
    clays: [],
    settings: null,
    photos: [],
    ...over,
  }
}

/** A zip built by hand, with a JPEG pair for each listed hash. */
function zipOf(json: unknown, imageHashes: string[] = []): Blob {
  const files: Record<string, Uint8Array> = {
    'glazette.json': strToU8(JSON.stringify(json)),
  }
  for (const h of imageHashes) {
    files[`photos/${h}.jpg`] = strToU8(`full-${h}`)
    files[`thumbs/${h}.jpg`] = strToU8(`thumb-${h}`)
  }
  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' })
}

const photoMeta = (id: string, hash: string): PhotoMeta => ({
  id,
  hash,
  width: 10,
  height: 20,
  takenAt: '2026-11-01T10:00:00.000Z',
})

const photoRow = (id: string, hash: string, deletedAt?: string): Photo => ({
  ...photoMeta(id, hash),
  blob: new Blob(['local'], { type: 'image/jpeg' }),
  thumb: new Blob(['local-t'], { type: 'image/jpeg' }),
  ...(deletedAt ? { deletedAt } : {}),
})

const withoutBytes = (photos: Photo[]) =>
  photos.map(({ blob: _b, thumb: _t, ...meta }) => meta)

/**
 * A row without the sync marks every local write gets (see src/sync/track.ts).
 * Not for pieces: their updatedAt is the app's own.
 */
function unmarked<T extends { dirty?: 1; updatedAt?: string }>(row: T) {
  const { dirty: _dirty, updatedAt: _updatedAt, ...rest } = row
  return rest
}

async function snapshot() {
  return {
    pieces: await db.pieces.toArray(),
    entries: (await db.entries.toArray()).map(unmarked),
    glazeApps: (await db.glazeApps.toArray()).map(unmarked),
    glazes: (await db.glazes.toArray()).map(unmarked),
    clays: (await db.clays.toArray()).map(unmarked),
    settings: (await db.settings.toArray()).map(unmarked),
    photos: withoutBytes(await db.photos.toArray()),
  }
}

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

async function seedEverything() {
  await db.pieces.bulkAdd([
    { id: 'p1', name: 'Mug', createdAt: 'a', updatedAt: 'b', clayId: 'c1' },
    { id: 'p2', createdAt: 'a', updatedAt: 'a', deletedAt: 'z' },
  ])
  await db.entries.bulkAdd([
    {
      id: 'e1',
      pieceId: 'p1',
      stage: 'thrown',
      photoId: 'ph1',
      date: '2026-11-01',
    },
    { id: 'e2', pieceId: 'p1', stage: 'trimmed' },
    { id: 'e3', pieceId: 'p1', stage: 'glazed', deletedAt: 'z' },
  ])
  await db.glazeApps.add({
    id: 'ga1',
    entryId: 'e3',
    pieceId: 'p1',
    glazeId: 'gl1',
    order: 0,
    dips: 2,
  })
  await db.glazes.add({ id: 'gl1', name: 'Celadon', color: '#9dbbaa' })
  await db.clays.add({ id: 'c1', name: 'Buff' })
  await db.settings.add({ ...SETTINGS }) // a copy: writes mark the object they are given
  await db.photos.bulkAdd([
    photoRow('ph1', 'h1'),
    photoRow('ph2', 'h2', '2026-11-03'),
  ])
}

beforeEach(clearAll)
afterEach(() => {
  vi.restoreAllMocks()
})

test('import into an empty database restores every table and photo', async () => {
  await seedEverything()
  const before = await snapshot()
  const zip = await exportZip()
  await clearAll()

  const result = await importZip(zip)

  // 2 pieces + 3 steps + 1 layer + 1 glaze + 1 clay + 2 photos + settings
  expect(result).toMatchObject({ added: 11, updated: 0 })
  const after = await snapshot()
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    expect(after[key]).toEqual(before[key])
  }
  const ph1 = await db.photos.get('ph1')
  expect(ph1?.blob).toBeDefined()
  expect(ph1?.thumb).toBeDefined()
})

test('importing the same zip twice adds nothing the second time', async () => {
  await seedEverything()
  const zip = await exportZip()
  await clearAll()
  await importZip(zip)
  expect(await importZip(zip)).toMatchObject({ added: 0, updated: 0 })
})

test('restore on a fresh install brings back the studio name and default clay', async () => {
  await ensureDefaults()
  const zip = zipOf(
    backup({ clays: [{ id: 'c1', name: 'Buff' }], settings: SETTINGS }),
  )

  const result = await importZip(zip)

  expect(unmarked((await db.settings.get('app')) as Settings)).toEqual(SETTINGS)
  expect(result).toMatchObject({ added: 1, updated: 1 }) // the clay; the settings
})

test('a default clay the backup does not contain keeps the current one', async () => {
  await ensureDefaults()
  const current = await db.settings.get('app')
  await importZip(
    zipOf(backup({ settings: { ...SETTINGS, defaultClayId: 'missing' } })),
  )
  const after = await db.settings.get('app')
  expect(after?.defaultClayId).toBe(current?.defaultClayId)
  expect(after?.studioName).toBe('Penguin Foot')
})

test('a photo already stored under another id is reused and steps are rewritten', async () => {
  await db.photos.add(photoRow('local-ph', 'h1'))
  const zip = zipOf(
    backup({
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' }],
      photos: [photoMeta('ph1', 'h1')],
    }),
    ['h1'],
  )

  const result = await importZip(zip)

  expect((await db.entries.get('e1'))?.photoId).toBe('local-ph')
  expect(await db.photos.get('ph1')).toBeUndefined()
  expect(await db.photos.count()).toBe(1)
  expect(result).toMatchObject({ added: 1, updated: 0 })
})

test('a reused photo that was deleted here comes back for a live incoming step', async () => {
  await db.photos.add(photoRow('local-ph', 'h1', '2026-11-03'))
  const zip = zipOf(
    backup({
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' }],
      photos: [photoMeta('ph1', 'h1')],
    }),
    ['h1'],
  )

  const result = await importZip(zip)

  expect((await db.photos.get('local-ph'))?.deletedAt).toBeUndefined()
  expect(result).toMatchObject({ added: 1, updated: 1 })
})

test('an incoming photo whose id is taken by a different photo gets a new id', async () => {
  await db.photos.add(photoRow('ph1', 'other-hash'))
  const zip = zipOf(
    backup({
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' }],
      photos: [photoMeta('ph1', 'h1')],
    }),
    ['h1'],
  )

  await importZip(zip)

  expect((await db.photos.get('ph1'))?.hash).toBe('other-hash')
  const photoId = (await db.entries.get('e1'))?.photoId
  expect(photoId).not.toBe('ph1')
  expect((await db.photos.get(photoId as string))?.hash).toBe('h1')
})

test('two photos with one hash in the zip become one row', async () => {
  const zip = zipOf(
    backup({
      entries: [
        { id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' },
        { id: 'e2', pieceId: 'p1', stage: 'trimmed', photoId: 'ph2' },
      ],
      photos: [photoMeta('ph1', 'h1'), photoMeta('ph2', 'h1')],
    }),
    ['h1'],
  )

  const result = await importZip(zip)

  expect(await db.photos.count()).toBe(1)
  expect((await db.entries.get('e2'))?.photoId).toBe('ph1')
  expect(result).toMatchObject({ added: 3, updated: 0 })
})

test('a photo missing from the zip is skipped and the step keeps its photoId', async () => {
  const zip = zipOf(
    backup({
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' }],
      photos: [photoMeta('ph1', 'h1')],
    }),
    [],
  )

  const result = await importZip(zip)

  expect(await db.photos.count()).toBe(0)
  expect((await db.entries.get('e1'))?.photoId).toBe('ph1')
  expect(result).toMatchObject({ added: 1, updated: 0 })
})

test('an undated step and a tombstoned piece round-trip unchanged', async () => {
  await db.pieces.add({
    id: 'p1',
    createdAt: 'a',
    updatedAt: 'b',
    deletedAt: '2026-11-04T00:00:00.000Z',
  })
  await db.entries.add({ id: 'e1', pieceId: 'p1', stage: 'bisqued' })
  await db.settings.add({ ...SETTINGS }) // a copy: writes mark the object they are given
  const before = await snapshot()
  const zip = await exportZip()
  await clearAll()

  await importZip(zip)

  const after = await snapshot()
  expect(after.entries[0]).not.toHaveProperty('date')
  expect(after.entries).toStrictEqual(before.entries)
  expect(after.pieces).toStrictEqual(before.pieces)
  expect(after.settings[0].studioName).toBe('Penguin Foot')
})

test('a piece is replaced only by a newer last change', async () => {
  await db.pieces.bulkAdd([
    { id: 'old', name: 'Here', createdAt: 'a', updatedAt: '2026-11-02' },
    { id: 'new', name: 'Here', createdAt: 'a', updatedAt: '2026-11-04' },
    { id: 'same', name: 'Here', createdAt: 'a', updatedAt: '2026-11-03' },
  ])
  const zip = zipOf(
    backup({
      pieces: [
        {
          id: 'old',
          name: 'Backup',
          createdAt: 'a',
          updatedAt: '2026-11-03',
          deletedAt: '2026-11-03T10:00:00.000Z',
        },
        { id: 'new', name: 'Backup', createdAt: 'a', updatedAt: '2026-11-03' },
        { id: 'same', name: 'Backup', createdAt: 'a', updatedAt: '2026-11-03' },
      ],
    }),
  )

  const result = await importZip(zip)

  expect(await db.pieces.get('old')).toMatchObject({
    name: 'Backup',
    deletedAt: '2026-11-03T10:00:00.000Z',
  })
  expect((await db.pieces.get('new'))?.name).toBe('Here')
  expect((await db.pieces.get('same'))?.name).toBe('Here')
  expect(result).toMatchObject({ added: 0, updated: 1 })
})

test('an incoming tombstone deletes an existing live step', async () => {
  await db.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    note: 'local',
  })
  await db.glazes.add({ id: 'gl1', name: 'Local', color: '#111111' })
  const zip = zipOf(
    backup({
      entries: [
        {
          id: 'e1',
          pieceId: 'p1',
          stage: 'thrown',
          note: 'backup',
          deletedAt: 'z',
        },
      ],
      glazes: [{ id: 'gl1', name: 'Backup', color: '#222222' }],
    }),
  )

  const result = await importZip(zip)

  const step = (await db.entries.get('e1')) as StageEntry
  expect(unmarked(step)).toEqual({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    note: 'local',
    deletedAt: 'z',
  })
  expect(step.dirty).toBe(1) // the tombstone is a change to sync
  expect(unmarked((await db.glazes.get('gl1')) as Glaze)).toEqual({
    id: 'gl1',
    name: 'Local',
    color: '#111111',
  })
  expect(result).toMatchObject({ added: 0, updated: 1 })
})

test('a bad glaze color becomes the default color', async () => {
  const zip = zipOf(
    backup({
      glazes: [
        { id: 'bad', name: 'X', color: 'red; background-image:url(x)' },
        { id: 'short', name: 'Y', color: '#abc' },
        { id: 'good', name: 'Z', color: '#A1b2C3' },
      ],
    }),
  )

  await importZip(zip)

  expect((await db.glazes.get('bad'))?.color).toBe(DEFAULT_GLAZE_COLOR)
  expect((await db.glazes.get('short'))?.color).toBe(DEFAULT_GLAZE_COLOR)
  expect((await db.glazes.get('good'))?.color).toBe('#A1b2C3')
})

test('a zip without glazette.json throws NotABackupError and writes nothing', async () => {
  await ensureDefaults()
  const before = await snapshot()
  const noJson = new Blob([zipSync({ 'other.txt': strToU8('hi') }) as BlobPart])

  await expect(importZip(noJson)).rejects.toBeInstanceOf(NotABackupError)
  await expect(
    importZip(new Blob(['not a zip at all'])),
  ).rejects.toBeInstanceOf(NotABackupError)
  await expect(
    importZip(zipOf({ ...backup(), version: 2 })),
  ).rejects.toBeInstanceOf(NotABackupError)
  await expect(
    importZip(zipOf({ ...backup(), pieces: 'nope' })),
  ).rejects.toBeInstanceOf(NotABackupError)
  const garbled = zipSync({ 'glazette.json': strToU8('{not json') })
  await expect(
    importZip(new Blob([garbled as BlobPart])),
  ).rejects.toBeInstanceOf(NotABackupError)

  expect(await snapshot()).toEqual(before)
})

test('a failure mid-import writes nothing', async () => {
  await seedEverything()
  const zip = await exportZip()
  await clearAll()
  await ensureDefaults()
  const before = await snapshot()
  // Steps are written after clays, glazes, pieces and photos.
  vi.spyOn(db.entries, 'bulkPut').mockRejectedValueOnce(new Error('disk full'))

  await expect(importZip(zip)).rejects.toThrow('disk full')
  expect(db.entries.bulkPut).toHaveBeenCalled()
  expect(await snapshot()).toEqual(before)
})

test('restore on a fresh install leaves one White stoneware that pieces and settings use', async () => {
  await ensureDefaults()
  const localClayId = (await db.settings.get('app'))?.defaultClayId
  const zip = zipOf(
    backup({
      clays: [{ id: 'w', name: 'White Stoneware ' }],
      pieces: [{ id: 'p1', createdAt: 'a', updatedAt: 'a', clayId: 'w' }],
      settings: { ...SETTINGS, defaultClayId: 'w' },
    }),
  )

  const result = await importZip(zip)

  const live = (await db.clays.toArray()).filter((c) => !c.deletedAt)
  expect(live).toHaveLength(1)
  expect(live[0].id).toBe(localClayId)
  expect((await db.pieces.get('p1'))?.clayId).toBe(localClayId)
  expect((await db.settings.get('app'))?.defaultClayId).toBe(localClayId)
  expect(result).toMatchObject({ added: 1, updated: 1 }) // the piece; the settings
  expect(await importZip(zip)).toMatchObject({ added: 0, updated: 0 })
})

test('a glaze made on both devices becomes one glaze that the layers use', async () => {
  await db.glazes.add({ id: 'local-gl', name: 'Celadon', color: '#111111' })
  const zip = zipOf(
    backup({
      glazes: [{ id: 'b-gl', name: 'celadon', color: '#222222' }],
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'glazed' }],
      glazeApps: [
        { id: 'ga1', entryId: 'e1', pieceId: 'p1', glazeId: 'b-gl', order: 0 },
      ],
    }),
  )

  await importZip(zip)

  expect((await db.glazes.toArray()).map(unmarked)).toEqual([
    { id: 'local-gl', name: 'Celadon', color: '#111111' },
  ])
  expect((await db.glazeApps.get('ga1'))?.glazeId).toBe('local-gl')
})

test('glaze layers come in only with a step this import adds', async () => {
  await db.entries.add({ id: 'local-step', pieceId: 'p1', stage: 'glazed' })
  const layer = (id: string, entryId: string) => ({
    id,
    entryId,
    pieceId: 'p1',
    glazeId: 'gl1',
    order: 0,
  })
  const zip = zipOf(
    backup({
      entries: [
        { id: 'local-step', pieceId: 'p1', stage: 'glazed' },
        { id: 'new-step', pieceId: 'p1', stage: 'glazed' },
      ],
      glazeApps: [
        layer('old-layer', 'local-step'),
        layer('new-layer', 'new-step'),
      ],
    }),
  )

  const result = await importZip(zip)

  expect(await db.glazeApps.get('old-layer')).toBeUndefined()
  expect(await db.glazeApps.get('new-layer')).toBeDefined()
  expect(result).toMatchObject({ added: 2, updated: 0 }) // new step + its layer
})

test('the later lastBackupAt wins', async () => {
  await db.clays.add({ id: 'c1', name: 'Buff' })
  await db.settings.add({
    ...SETTINGS,
    lastBackupAt: '2026-11-04T00:00:00.000Z',
  })
  const older = zipOf(
    backup({
      settings: { ...SETTINGS, lastBackupAt: '2026-11-01T00:00:00.000Z' },
    }),
  )
  expect(await importZip(older)).toMatchObject({ added: 0, updated: 0 })
  expect(await db.settings.get('app')).toMatchObject({
    lastBackupAt: '2026-11-04T00:00:00.000Z',
  })

  const newer = zipOf(
    backup({
      settings: { ...SETTINGS, lastBackupAt: '2026-11-05T00:00:00.000Z' },
    }),
  )
  expect(await importZip(newer)).toMatchObject({ added: 0, updated: 1 })
  expect(await importZip(newer)).toMatchObject({ added: 0, updated: 0 })
  expect(await db.settings.get('app')).toMatchObject({
    lastBackupAt: '2026-11-05T00:00:00.000Z',
  })
})

test('a backup cannot set persistRequested', async () => {
  await importZip(
    zipOf(backup({ settings: { ...SETTINGS, persistRequested: true } })),
  )
  expect(await db.settings.get('app')).not.toHaveProperty('persistRequested')
})

test('an old local persistRequested flag does not count as a settings change', async () => {
  await db.clays.add({ id: 'c1', name: 'Buff' })
  await db.settings.add({ ...SETTINGS, persistRequested: true })
  expect(await importZip(zipOf(backup({ settings: SETTINGS })))).toMatchObject({
    added: 0,
    updated: 0,
  })
})

test('a tombstoned default clay keeps the current one', async () => {
  await ensureDefaults()
  const current = (await db.settings.get('app'))?.defaultClayId
  await importZip(
    zipOf(
      backup({
        clays: [{ id: 'c1', name: 'Buff', deletedAt: 'z' }],
        settings: SETTINGS,
      }),
    ),
  )
  expect((await db.settings.get('app'))?.defaultClayId).toBe(current)
})

test('a missing photo whose id belongs to another photo here shows a placeholder', async () => {
  await db.photos.add(photoRow('ph1', 'other-hash'))
  const zip = zipOf(
    backup({
      entries: [{ id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' }],
      photos: [photoMeta('ph1', 'h1')],
    }),
    [],
  )

  await importZip(zip)

  const photoId = (await db.entries.get('e1'))?.photoId
  expect(photoId).toBeDefined()
  expect(photoId).not.toBe('ph1')
  expect(await db.photos.get(photoId as string)).toBeUndefined()
  expect(await db.photos.count()).toBe(1)
})

test('malformed rows and settings are not a backup', async () => {
  const bad: unknown[] = [
    { ...backup(), clays: [{ id: 'c1', name: 7 }] },
    { ...backup(), glazes: [{ id: 'g1', color: '#111111' }] },
    { ...backup(), entries: [{ id: 'e1', stage: 'thrown', deletedAt: null }] },
    { ...backup(), pieces: [{ id: 'p1', updatedAt: 'a', deletedAt: 5 }] },
    { ...backup(), settings: { ...SETTINGS, bisqueNote: undefined } },
    { ...backup(), settings: { ...SETTINGS, studioName: 5 } },
    { ...backup(), settings: { ...SETTINGS, defaultClayId: ['c1'] } },
  ]
  for (const json of bad) {
    await expect(importZip(zipOf(json))).rejects.toBeInstanceOf(NotABackupError)
  }
  expect(await db.clays.count()).toBe(0)
  expect(await db.settings.count()).toBe(0)
})

test('a file without the zip signature is not a backup', async () => {
  const bytes = await lenientBytes(zipOf(backup({ settings: SETTINGS })))
  bytes[0] = 0x58
  bytes[1] = 0x58
  await expect(importZip(new Blob([bytes as BlobPart]))).rejects.toBeInstanceOf(
    NotABackupError,
  )
  expect(await db.settings.count()).toBe(0)
})

test('a piece deleted here stays deleted when the backup copy is live and not newer', async () => {
  const id = await createPiece({ name: 'Mug' })
  const created = (await db.pieces.get(id))?.updatedAt as string
  await softDelete('pieces', id)
  const zip = zipOf(
    backup({
      pieces: [{ id, name: 'Mug', createdAt: created, updatedAt: created }],
    }),
  )

  const result = await importZip(zip)

  expect((await db.pieces.get(id))?.deletedAt).toBeTruthy()
  expect(result).toMatchObject({ added: 0, updated: 0 })
})

test('a piece deleted with the app in the backup deletes the live local copy', async () => {
  const id = await createPiece({ name: 'Mug' })
  const live = (await db.pieces.get(id)) as Piece
  const deletedAt = new Date(Date.parse(live.updatedAt) + 60_000).toISOString()
  const zip = zipOf(backup({ pieces: [{ ...live, deletedAt }] }))

  const result = await importZip(zip)

  expect((await db.pieces.get(id))?.deletedAt).toBe(deletedAt)
  expect(result).toMatchObject({ added: 0, updated: 1 })
})

test('an incoming step tombstone releases its photo when no other live step uses it', async () => {
  await db.photos.add(photoRow('ph1', 'h1'))
  await db.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph1',
  })
  const zip = zipOf(
    backup({
      entries: [
        {
          id: 'e1',
          pieceId: 'p1',
          stage: 'thrown',
          photoId: 'ph1',
          deletedAt: '2026-11-04T09:00:00.000Z',
        },
      ],
      photos: [photoMeta('ph1', 'h1')],
    }),
    ['h1'],
  )

  await importZip(zip)

  expect((await db.photos.get('ph1'))?.deletedAt).toBe(
    '2026-11-04T09:00:00.000Z',
  )
})

test('an incoming step tombstone keeps a photo another live step still uses', async () => {
  await db.photos.add(photoRow('ph1', 'h1'))
  await db.entries.bulkAdd([
    { id: 'e1', pieceId: 'p1', stage: 'thrown', photoId: 'ph1' },
    { id: 'e2', pieceId: 'p1', stage: 'trimmed', photoId: 'ph1' },
  ])
  const zip = zipOf(
    backup({
      entries: [
        {
          id: 'e1',
          pieceId: 'p1',
          stage: 'thrown',
          photoId: 'ph1',
          deletedAt: 'z',
        },
      ],
    }),
  )

  await importZip(zip)

  expect((await db.entries.get('e1'))?.deletedAt).toBe('z')
  expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
})

test('an incoming photo tombstone applies to a local photo with the same hash that no live step uses', async () => {
  await db.photos.add(photoRow('local-ph', 'h1'))
  const zip = zipOf(
    backup({
      photos: [
        { ...photoMeta('ph1', 'h1'), deletedAt: '2026-11-04T09:00:00.000Z' },
      ],
    }),
    ['h1'],
  )

  await importZip(zip)

  expect((await db.photos.get('local-ph'))?.deletedAt).toBe(
    '2026-11-04T09:00:00.000Z',
  )
})

test('an incoming photo tombstone does not delete a local photo a live step uses', async () => {
  await db.photos.add(photoRow('local-ph', 'h1'))
  await db.entries.add({
    id: 'e9',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'local-ph',
  })
  const zip = zipOf(
    backup({
      photos: [{ ...photoMeta('ph1', 'h1'), deletedAt: 'z' }],
    }),
    ['h1'],
  )

  await importZip(zip)

  expect((await db.photos.get('local-ph'))?.deletedAt).toBeUndefined()
})

test('a backup from a newer database version is refused and writes nothing', async () => {
  await ensureDefaults()
  const before = await snapshot()
  await expect(
    importZip(zipOf({ ...backup(), dbVersion: db.verno + 1 })),
  ).rejects.toBeInstanceOf(NewerBackupError)
  expect(await snapshot()).toEqual(before)
  await expect(
    importZip(zipOf({ ...backup(), dbVersion: db.verno })),
  ).resolves.toBeDefined()
})

test.each([
  ['an entry without pieceId', { entries: [{ id: 'e', stage: 'thrown' }] }],
  [
    'an entry with an unknown stage',
    { entries: [{ id: 'e', pieceId: 'p', stage: 'baked' }] },
  ],
  [
    'an entry with a numeric note',
    { entries: [{ id: 'e', pieceId: 'p', stage: 'thrown', note: 5 }] },
  ],
  [
    'an entry with a numeric date',
    { entries: [{ id: 'e', pieceId: 'p', stage: 'thrown', date: 5 }] },
  ],
  [
    'an entry with a numeric photoId',
    { entries: [{ id: 'e', pieceId: 'p', stage: 'thrown', photoId: 5 }] },
  ],
  [
    'a layer without entryId',
    { glazeApps: [{ id: 'a', pieceId: 'p', glazeId: 'g', order: 0 }] },
  ],
  [
    'a layer without pieceId',
    { glazeApps: [{ id: 'a', entryId: 'e', glazeId: 'g', order: 0 }] },
  ],
  [
    'a layer without glazeId',
    { glazeApps: [{ id: 'a', entryId: 'e', pieceId: 'p', order: 0 }] },
  ],
  [
    'a layer with a non-numeric order',
    {
      glazeApps: [
        { id: 'a', entryId: 'e', pieceId: 'p', glazeId: 'g', order: '0' },
      ],
    },
  ],
  ['a piece without createdAt', { pieces: [{ id: 'p', updatedAt: 'a' }] }],
])('a backup with %s is not a backup', async (_name, over) => {
  await ensureDefaults()
  const before = await snapshot()
  await expect(importZip(zipOf(backup(over as never)))).rejects.toBeInstanceOf(
    NotABackupError,
  )
  expect(await snapshot()).toEqual(before)
})

test('the result counts pieces added, replaced and newly deleted, not other rows', async () => {
  await db.pieces.bulkAdd([
    { id: 'old', createdAt: 'a', updatedAt: '2026-11-02' },
    { id: 'same', createdAt: 'a', updatedAt: '2026-11-03' },
  ])
  const zip = zipOf(
    backup({
      pieces: [
        { id: 'old', createdAt: 'a', updatedAt: '2026-11-03' },
        { id: 'same', createdAt: 'a', updatedAt: '2026-11-03' },
        { id: 'new', createdAt: 'a', updatedAt: '2026-11-03' },
      ],
      entries: [
        { id: 'e1', pieceId: 'new', stage: 'thrown' },
        { id: 'e2', pieceId: 'new', stage: 'trimmed' },
      ],
      clays: [{ id: 'c1', name: 'Buff' }],
    }),
  )
  const result = await importZip(zip)
  expect(result.pieces).toBe(2)
  expect(result.added).toBe(4)
  expect((await importZip(zip)).pieces).toBe(0)
})
