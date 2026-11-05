import 'fake-indexeddb/auto'
import { unzipSync } from 'fflate'
import { beforeEach, expect, test } from 'vitest'
import { db } from '../db/db'
import { lenientBytes } from '../test/bytes'
import {
  backupFileName,
  exportZip as exportStrict,
  readBlobBytes,
} from './export'
import type { BackupJson } from './format'

const exportZip = (now?: Date) => exportStrict(now, lenientBytes)

async function unpack(blob: Blob) {
  const files = unzipSync(await lenientBytes(blob))
  const json = JSON.parse(
    new TextDecoder().decode(files['glazette.json']),
  ) as BackupJson
  return { files, json }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

test('export holds every table, tombstones included, and photos by hash', async () => {
  await db.pieces.bulkAdd([
    { id: 'p1', createdAt: 'a', updatedAt: 'a' },
    { id: 'p2', createdAt: 'a', updatedAt: 'a', deletedAt: 'z' },
  ])
  await db.entries.add({
    id: 'e1',
    pieceId: 'p1',
    stage: 'thrown',
    photoId: 'ph1',
    date: '2026-11-01',
    deletedAt: 'z',
  })
  await db.glazeApps.add({
    id: 'g1',
    entryId: 'e1',
    pieceId: 'p1',
    glazeId: 'gl1',
    order: 0,
  })
  await db.glazes.add({
    id: 'gl1',
    name: 'Celadon',
    color: '#abc',
    deletedAt: 'z',
  })
  await db.clays.add({ id: 'c1', name: 'Buff' })
  await db.photos.bulkAdd([
    {
      id: 'ph1',
      blob: new Blob(['full1'], { type: 'image/jpeg' }),
      thumb: new Blob(['thumb1'], { type: 'image/jpeg' }),
      hash: 'h1',
      width: 10,
      height: 20,
      takenAt: 't',
    },
    {
      id: 'ph2',
      blob: new Blob(['full2'], { type: 'image/jpeg' }),
      thumb: new Blob(['thumb2'], { type: 'image/jpeg' }),
      hash: 'h2',
      width: 1,
      height: 2,
      takenAt: 't',
      deletedAt: 'z',
    },
  ])

  const out = await exportZip(new Date('2026-11-05T12:00:00Z'))
  expect(out.type).toBe('application/zip')
  const { files, json } = await unpack(out)
  expect(json.version).toBe(1)
  expect(json.dbVersion).toBe(db.verno)
  expect(json.exportedAt).toBe('2026-11-05T12:00:00.000Z')
  expect(json.pieces.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  expect(json.entries[0].deletedAt).toBe('z')
  expect(json.glazeApps).toHaveLength(1)
  expect(json.glazes[0].deletedAt).toBe('z')
  expect(json.clays).toHaveLength(1)
  expect(json.photos.map((p) => p.hash).sort()).toEqual(['h1', 'h2'])
  expect(json.photos[0]).not.toHaveProperty('blob')
  expect(json.photos[0]).not.toHaveProperty('thumb')
  expect(json.photos.find((p) => p.id === 'ph2')?.deletedAt).toBe('z')
  expect(Object.keys(files).sort()).toEqual([
    'glazette.json',
    'photos/h1.jpg',
    'photos/h2.jpg',
    'thumbs/h1.jpg',
    'thumbs/h2.jpg',
  ])
  // Contents aren't checked: fake-indexeddb drops stored Blob bytes.
})

test('an undated step exports with no date key', async () => {
  await db.entries.add({ id: 'e1', pieceId: 'p1', stage: 'bisqued' })
  const { json } = await unpack(await exportZip())
  expect(json.entries[0]).not.toHaveProperty('date')
})

test('settings export includes the studio name', async () => {
  await db.settings.add({
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'b',
    firedNote: 'f',
    studioName: 'Penguin Foot',
  })
  const { json } = await unpack(await exportZip())
  expect(json.settings?.studioName).toBe('Penguin Foot')
})

test('backupFileName uses the local day', () => {
  expect(backupFileName(new Date(2026, 10, 5, 23, 30))).toBe(
    'glazette-2026-11-05.zip',
  )
})

test('the default reader rejects a non-Blob instead of exporting nothing', async () => {
  await expect(readBlobBytes({} as Blob)).rejects.toThrow(/not a Blob/)
  await db.photos.add({
    id: 'ph1',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    thumb: new Blob(['t'], { type: 'image/jpeg' }),
    hash: 'h1',
    width: 1,
    height: 1,
    takenAt: 't',
  })
  // fake-indexeddb hands back plain objects, so the strict default must fail.
  await expect(exportStrict()).rejects.toThrow(/not a Blob/)
})
