import {
  EPOCH,
  MAX_DATA_CHARS,
  type SyncRecord,
} from '../../shared/syncProtocol'
import { comboId } from '../db/combos'
import { GlazetteDB } from '../db/db'
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import type { Glaze, Photo, Piece } from '../db/types'
import {
  applyRecords,
  changedAt,
  clearDirty,
  markAllDirty,
  mergeByName,
  readDirty,
  toRecord,
} from './records'
import { quietly } from './track'

let db: GlazetteDB

beforeEach(async () => {
  db = new GlazetteDB(`records-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-01T00:00:00.000Z'
const T3 = '2026-03-01T00:00:00.000Z'

const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  createdAt: T1,
  updatedAt: T1,
  ...extra,
})

const glaze = (
  id: string,
  name: string,
  extra: Partial<Glaze> = {},
): Glaze => ({
  id,
  name,
  color: '#112233',
  updatedAt: T1,
  ...extra,
})

const pieceRecord = (
  id: string,
  changed: string,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'piece',
  id,
  changedAt: changed,
  data: { id, createdAt: T1, updatedAt: changed, ...extra },
})

test('changedAt takes the later of updatedAt and deletedAt, and treats missing or garbled times as 1970', () => {
  expect(changedAt({ updatedAt: T1, deletedAt: T2 })).toBe(T2)
  expect(changedAt({ updatedAt: T3, deletedAt: T2 })).toBe(T3)
  expect(changedAt({ updatedAt: T1 })).toBe(T1)
  expect(changedAt({ deletedAt: T2 })).toBe(T2)
  expect(changedAt({})).toBe(EPOCH)
  expect(changedAt({ updatedAt: 'garbage' })).toBe(EPOCH)
  expect(changedAt({ updatedAt: '2026-01-01' })).toBe(T1)
  expect(changedAt({ updatedAt: 'garbage', deletedAt: T2 })).toBe(T2)
})

test('toRecord leaves out device-only fields', () => {
  const record = toRecord('settings', {
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'b',
    firedNote: 'f',
    updatedAt: T2,
    lastBackupAt: T3,
    persistRequested: true,
    dirty: 1,
  })
  expect(record).toEqual({
    kind: 'settings',
    id: 'app',
    changedAt: T2,
    data: {
      id: 'app',
      defaultCone: '6',
      bisqueNote: 'b',
      firedNote: 'f',
      updatedAt: T2,
    },
  })
})

test('readDirty skips a record too big to send and keeps it waiting', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await db.pieces.add(piece('big', { notes: 'x'.repeat(MAX_DATA_CHARS + 1) }))
  await db.pieces.add(piece('small'))
  const records = await readDirty(db)
  expect(records.map((r) => r.id)).toEqual(['small'])
  expect(warn).toHaveBeenCalled()
  expect((await db.pieces.get('big'))?.dirty).toBe(1)
  warn.mockRestore()
})

test('readDirty sends a piece with 60,000 characters of notes', async () => {
  await db.pieces.add(piece('long', { notes: 'x'.repeat(60_000) }))
  const records = await readDirty(db)
  expect(records.map((r) => r.id)).toEqual(['long'])
})

test('readDirty returns only dirty rows, from every synced table', async () => {
  await db.pieces.add(piece('p1'))
  await db.clays.add({ id: 'c1', name: 'White' })
  await quietly(db, () => db.clays.put({ id: 'c2', name: 'Red' }))
  const records = await readDirty(db)
  expect(records.map((r) => `${r.kind}:${r.id}`).sort()).toEqual([
    'clay:c1',
    'piece:p1',
  ])
})

test('markAllDirty marks every row without changing its time', async () => {
  await quietly(db, () => db.pieces.add(piece('p1')))
  await markAllDirty(db)
  expect(await db.pieces.get('p1')).toMatchObject({ dirty: 1, updatedAt: T1 })
})

test("markAllDirty leaves purged rows out, and a purged photo doesn't wait to upload", async () => {
  await quietly(db, async () => {
    await db.pieces.add(piece('stub', { deletedAt: T2, purgedAt: T2 }))
    await db.entries.add({
      id: 'e1',
      pieceId: 'stub',
      stage: 'thrown',
      deletedAt: T2,
      purgedAt: T2,
    })
    await db.photos.add({
      id: 'ph1',
      hash: 'a'.repeat(64),
      width: 1,
      height: 1,
      takenAt: T1,
      deletedAt: T2,
      purgedAt: T2,
      blob: new Blob(['full']),
    })
    await db.pieces.add(piece('live'))
  })
  await markAllDirty(db)
  expect((await db.pieces.get('stub'))?.dirty).toBeUndefined()
  expect((await db.entries.get('e1'))?.dirty).toBeUndefined()
  const stub = await db.photos.get('ph1')
  expect(stub?.dirty).toBeUndefined()
  expect(stub?.needsUpload).toBeUndefined()
  expect((await db.pieces.get('live'))?.dirty).toBe(1)
  expect((await readDirty(db)).map((r) => r.id)).toEqual(['live'])
})

const HASH = 'a'.repeat(64)

const photoRow = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  hash: HASH,
  width: 10,
  height: 20,
  takenAt: T1,
  updatedAt: T1,
  ...extra,
})

const photoRecord = (
  id: string,
  changed: string,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'photo',
  id,
  changedAt: changed,
  data: {
    id,
    hash: HASH,
    width: 10,
    height: 20,
    takenAt: T1,
    updatedAt: changed,
    ...extra,
  },
})

const bytes = { blob: new Blob(['full']), thumb: new Blob(['thumb']) }

test("toRecord leaves a photo's bytes and flags behind", () => {
  const record = toRecord(
    'photo',
    photoRow('ph1', {
      ...bytes,
      dirty: 1,
      needsUpload: 1,
      needsDownload: 1,
    }) as never,
  )
  expect(record.data).toEqual({
    id: 'ph1',
    hash: HASH,
    width: 10,
    height: 20,
    takenAt: T1,
    updatedAt: T1,
  })
})

describe('photo records', () => {
  test('a pulled photo with no bytes here waits to download', async () => {
    await applyRecords(db, [photoRecord('ph1', T2)])
    const row = await db.photos.get('ph1')
    expect(row).toMatchObject({ id: 'ph1', needsDownload: 1 })
    expect(row?.blob).toBeUndefined()
    expect(row?.dirty).toBeUndefined()
  })

  test('a pulled photo keeps the bytes already here', async () => {
    await quietly(db, () =>
      db.photos.add(photoRow('ph1', { ...bytes, needsUpload: 1 })),
    )
    await applyRecords(db, [photoRecord('ph1', T2)])
    const row = await db.photos.get('ph1')
    expect(row?.blob).toBeDefined()
    expect(row?.thumb).toBeDefined()
    expect(row?.needsUpload).toBe(1)
    expect(row?.needsDownload).toBeUndefined()
    expect(row?.updatedAt).toBe(T2)
  })

  test('a pulled photo tombstone keeps the bytes here', async () => {
    await quietly(db, () => db.photos.add(photoRow('ph1', bytes)))
    await applyRecords(db, [photoRecord('ph1', T2, { deletedAt: T2 })])
    const row = await db.photos.get('ph1')
    expect(row?.deletedAt).toBe(T2)
    expect(row?.blob).toBeDefined()
    expect(row?.needsDownload).toBeUndefined()
  })

  test("a pulled photo whose hash is in the table doesn't wait to download", async () => {
    await quietly(db, () =>
      db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) }),
    )
    await applyRecords(db, [photoRecord('ph1', T2)])
    const row = await db.photos.get('ph1')
    expect(row?.id).toBe('ph1')
    expect(row?.needsDownload).toBeUndefined()
  })

  test('a pulled photo replacing a row loses its wait when the hash is in the table', async () => {
    await quietly(db, async () => {
      await db.photos.add(photoRow('ph1', { needsDownload: 1 }))
      await db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
    })
    await applyRecords(db, [photoRecord('ph1', T2)])
    expect((await db.photos.get('ph1'))?.needsDownload).toBeUndefined()
  })

  test("applying photo records reads only the bytes table's keys", async () => {
    await quietly(db, () =>
      db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) }),
    )
    const reads = [
      vi.spyOn(db.photoBytes, 'get'),
      vi.spyOn(db.photoBytes, 'bulkGet'),
      vi.spyOn(db.photoBytes, 'toArray'),
    ]
    await applyRecords(db, [photoRecord('ph1', T2)])
    await markAllDirty(db)
    for (const read of reads) expect(read).not.toHaveBeenCalled()
  })

  test('a photo record with a bad hash is skipped', async () => {
    const result = await applyRecords(db, [
      photoRecord('ph1', T2, { hash: 'nope' }),
    ])
    expect(result.skipped).toBe(1)
    expect(await db.photos.count()).toBe(0)
  })

  test('markAllDirty marks every photo with bytes as waiting to upload', async () => {
    await quietly(db, async () => {
      await db.photos.add(photoRow('with', bytes))
      await db.photos.add(photoRow('without', { hash: 'b'.repeat(64) }))
    })
    await markAllDirty(db)
    expect(await db.photos.get('with')).toMatchObject({
      dirty: 1,
      needsUpload: 1,
      updatedAt: T1,
    })
    const without = await db.photos.get('without')
    expect(without?.dirty).toBe(1)
    expect(without?.needsUpload).toBeUndefined()
  })

  test('markAllDirty marks a photo waiting to upload when its bytes are in the table', async () => {
    await quietly(db, async () => {
      await db.photos.add(photoRow('moved'))
      await db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
      await db.photos.add(photoRow('elsewhere', { hash: 'b'.repeat(64) }))
    })
    await markAllDirty(db)
    expect(await db.photos.get('moved')).toMatchObject({
      dirty: 1,
      needsUpload: 1,
      updatedAt: T1,
    })
    expect((await db.photos.get('elsewhere'))?.needsUpload).toBeUndefined()
  })

  test('a push sends steps before photos', async () => {
    await db.photos.add(photoRow('ph1'))
    await db.entries.add({ id: 'e1', pieceId: 'p1', stage: 'thrown' })
    const kinds = (await readDirty(db)).map((r) => r.kind)
    expect(kinds).toEqual(['entry', 'photo'])
  })
})

describe('applyRecords follows the later-change rule', () => {
  test('writes a record with no local row', async () => {
    const result = await applyRecords(db, [
      pieceRecord('p1', T2, { name: 'A' }),
    ])
    expect(result).toEqual({ applied: 1, skipped: 0, skippedKeys: new Set() })
    const row = await db.pieces.get('p1')
    expect(row).toMatchObject({ name: 'A', updatedAt: T2 })
    expect(row?.dirty).toBeUndefined()
  })

  test('writes a record later than the local row', async () => {
    await db.pieces.add(piece('p1', { name: 'mine' }))
    await applyRecords(db, [pieceRecord('p1', T2, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('theirs')
    expect(row?.dirty).toBeUndefined()
  })

  test('on a tie, the record wins over a dirty local row and clears dirty', async () => {
    await db.pieces.add(piece('p1', { name: 'mine' }))
    await applyRecords(db, [pieceRecord('p1', T1, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('theirs')
    expect(row?.dirty).toBeUndefined()
  })

  test('on a tie, a clean local row stays', async () => {
    await quietly(db, () => db.pieces.add(piece('p1', { name: 'mine' })))
    await applyRecords(db, [pieceRecord('p1', T1, { name: 'theirs' })])
    expect((await db.pieces.get('p1'))?.name).toBe('mine')
  })

  test('keeps a local row that is later', async () => {
    await db.pieces.add(piece('p1', { name: 'mine', updatedAt: T3 }))
    await applyRecords(db, [pieceRecord('p1', T2, { name: 'theirs' })])
    const row = await db.pieces.get('p1')
    expect(row?.name).toBe('mine')
    expect(row?.dirty).toBe(1)
  })

  test('a later tombstone deletes a local row', async () => {
    await quietly(db, () => db.pieces.add(piece('p1')))
    await applyRecords(db, [
      {
        kind: 'piece',
        id: 'p1',
        changedAt: T2,
        data: { id: 'p1', createdAt: T1, updatedAt: T1, deletedAt: T2 },
      },
    ])
    expect((await db.pieces.get('p1'))?.deletedAt).toBe(T2)
  })
})

test('a pulled newer piece brings its glaze plan whole', async () => {
  await db.pieces.add(
    piece('p1', { glazePlan: [{ glazeId: 'a' }, { glazeId: 'c' }] }),
  )
  await applyRecords(db, [
    pieceRecord('p1', T2, { glazePlan: [{ glazeId: 'b' }] }),
  ])
  expect((await db.pieces.get('p1'))?.glazePlan).toEqual([{ glazeId: 'b' }])
})

test('a piece record with a malformed glaze plan is skipped', async () => {
  const result = await applyRecords(db, [
    pieceRecord('p1', T2, { glazePlan: 'x' }),
  ])
  expect(result.skippedKeys).toEqual(new Set(['piece/p1']))
  expect(await db.pieces.count()).toBe(0)
})

test("applyRecords skips what it can't use and applies the rest", async () => {
  const result = await applyRecords(db, [
    { kind: 'sticker', id: 'x1', changedAt: T1, data: { id: 'x1' } },
    {
      kind: 'entry',
      id: 'e1',
      changedAt: T1,
      data: { id: 'e1', pieceId: 'p1', stage: 'kilned' },
    },
    {
      kind: 'piece',
      id: 'p2',
      changedAt: T1,
      data: { id: 'p2', updatedAt: T1 },
    },
    {
      kind: 'glaze',
      id: 'g1',
      changedAt: T1,
      data: { id: 'g1', name: 'Shino', color: '#aabbcc' },
    },
  ])
  expect(result).toEqual({
    applied: 1,
    skipped: 3,
    skippedKeys: new Set(['sticker/x1', 'entry/e1', 'piece/p2']),
  })
  expect(await db.glazes.toArray()).toHaveLength(1)
  expect(await db.entries.count()).toBe(0)
  expect(await db.pieces.count()).toBe(0)
})

test('applyRecords names the records it skipped, including ones the local row beat', async () => {
  await db.pieces.add(piece('later', { updatedAt: T3 }))
  const result = await applyRecords(db, [
    pieceRecord('later', T2),
    pieceRecord('new', T2),
    null,
    { kind: 'piece', changedAt: T1 },
  ])
  expect(result).toEqual({
    applied: 1,
    skipped: 3,
    skippedKeys: new Set(['piece/later']),
  })
})

test('applyRecords applies records for the same row in order', async () => {
  await db.pieces.add(piece('p1', { name: 'mine' }))
  const result = await applyRecords(db, [
    pieceRecord('p1', T1, { name: 'first' }),
    // A tie with the now clean row: the row stays.
    pieceRecord('p1', T1, { name: 'tie' }),
    pieceRecord('p1', T2, { name: 'later' }),
  ])
  expect(result).toMatchObject({ applied: 2, skipped: 1 })
  const row = await db.pieces.get('p1')
  expect(row?.name).toBe('later')
  expect(row?.dirty).toBeUndefined()
})

test("applyRecords keeps this device's lastBackupAt", async () => {
  await db.settings.add({
    id: 'app',
    defaultCone: '6',
    bisqueNote: 'b',
    firedNote: 'f',
    lastBackupAt: T3,
    persistRequested: true,
    updatedAt: T1,
  })
  await applyRecords(db, [
    {
      kind: 'settings',
      id: 'app',
      changedAt: T2,
      data: {
        id: 'app',
        defaultCone: '04',
        bisqueNote: 'b',
        firedNote: 'f',
        updatedAt: T2,
      },
    },
  ])
  const row = await db.settings.get('app')
  expect(row).toMatchObject({
    defaultCone: '04',
    lastBackupAt: T3,
    persistRequested: true,
  })
  expect(row?.dirty).toBeUndefined()
})

test("applyRecords keeps a field it doesn't know", async () => {
  await applyRecords(db, [pieceRecord('p1', T2, { extra: 1 })])
  expect(await db.pieces.get('p1')).toMatchObject({ extra: 1 })
})

test('applyRecords never writes dirty from a record', async () => {
  await applyRecords(db, [pieceRecord('p1', T2, { dirty: 1 })])
  expect((await db.pieces.get('p1'))?.dirty).toBeUndefined()
})

test('applyRecords fixes a glaze color it cannot show', async () => {
  await applyRecords(db, [
    {
      kind: 'glaze',
      id: 'g1',
      changedAt: T1,
      data: { id: 'g1', name: 'Shino', color: 'blue' },
    },
  ])
  expect((await db.glazes.get('g1'))?.color).toMatch(/^#[0-9a-f]{6}$/i)
})

describe('stubs', () => {
  const PURGED = '2026-04-01T00:00:00.000Z'

  /** What the server keeps of a purged record: its old change time, and only its id and times. */
  const stub = (kind: SyncRecord['kind'], id: string): SyncRecord => ({
    kind,
    id,
    changedAt: T1,
    data: { id, deletedAt: PURGED, purgedAt: PURGED },
  })

  test('a stub marks the local row deleted and keeps its bytes', async () => {
    await db.photoBytes.add({ hash: HASH, blob: new Blob(['full']) })
    const held = await db.photoBytes.get(HASH)
    await db.photos.add(
      photoRow('ph1', { dirty: 1, needsUpload: 1, needsDownload: 1 }),
    )
    const result = await applyRecords(db, [stub('photo', 'ph1')])
    expect(result).toEqual({ applied: 1, skipped: 0, skippedKeys: new Set() })
    expect(await db.photoBytes.get(HASH)).toEqual(held)
    const row = await db.photos.get('ph1')
    expect(row).toMatchObject({
      hash: HASH,
      deletedAt: PURGED,
      purgedAt: PURGED,
    })
    expect(row?.dirty).toBeUndefined()
    expect(row?.needsUpload).toBeUndefined()
    expect(row?.needsDownload).toBeUndefined()
  })

  test('a stub wins whatever its change time', async () => {
    await db.pieces.add(piece('p1', { updatedAt: T3 }))
    expect((await db.pieces.get('p1'))?.dirty).toBe(1)
    await applyRecords(db, [stub('piece', 'p1')])
    const row = await db.pieces.get('p1')
    expect(row).toMatchObject({ deletedAt: PURGED, purgedAt: PURGED })
    expect(row?.dirty).toBeUndefined()
  })

  test('a stub keeps the time a row was deleted here', async () => {
    await db.pieces.add(piece('p1', { deletedAt: T2 }))
    await applyRecords(db, [stub('piece', 'p1')])
    expect(await db.pieces.get('p1')).toMatchObject({
      deletedAt: T2,
      purgedAt: PURGED,
    })
  })

  test('a stub with no local row writes nothing', async () => {
    const result = await applyRecords(db, [stub('photo', 'ph1')])
    expect(result).toEqual({ applied: 0, skipped: 0, skippedKeys: new Set() })
    expect(await db.photos.count()).toBe(0)
  })

  test("a stub keeps the row's other fields", async () => {
    await db.pieces.add(piece('p1', { name: 'Bowl', notes: 'blue rim' }))
    await applyRecords(db, [stub('piece', 'p1')])
    expect(await db.pieces.get('p1')).toMatchObject({
      name: 'Bowl',
      notes: 'blue rim',
      createdAt: T1,
      updatedAt: T1,
    })
  })

  test('a stubbed record passes the row checks', async () => {
    await quietly(db, async () => {
      await db.pieces.add(piece('p1'))
      await db.entries.add({ id: 'e1', pieceId: 'p1', stage: 'thrown' })
      await db.glazeApps.add({
        id: 'l1',
        entryId: 'e1',
        pieceId: 'p1',
        glazeId: 'g1',
        order: 0,
      })
      await db.photos.add(photoRow('ph1'))
    })
    const result = await applyRecords(db, [
      stub('piece', 'p1'),
      stub('entry', 'e1'),
      stub('glazeApp', 'l1'),
      stub('photo', 'ph1'),
    ])
    expect(result).toEqual({ applied: 4, skipped: 0, skippedKeys: new Set() })
    expect((await db.entries.get('e1'))?.purgedAt).toBe(PURGED)
    expect((await db.glazeApps.get('l1'))?.purgedAt).toBe(PURGED)
  })

  test("a glaze, which never expires, isn't treated as a stub", async () => {
    const result = await applyRecords(db, [
      {
        kind: 'glaze',
        id: 'g1',
        changedAt: T1,
        data: { id: 'g1', deletedAt: PURGED, purgedAt: PURGED },
      },
    ])
    expect(result.skippedKeys).toEqual(new Set(['glaze/g1']))
  })
})

test('clearDirty keeps a row that changed after it was read dirty', async () => {
  await db.pieces.add(piece('p1'))
  await db.pieces.add(piece('p2'))
  const records = await readDirty(db)
  await db.pieces.update('p2', { name: 'edited', updatedAt: T3 })
  await clearDirty(db, records)
  expect((await db.pieces.get('p1'))?.dirty).toBeUndefined()
  expect((await db.pieces.get('p2'))?.dirty).toBe(1)
})

describe('mergeByName', () => {
  // The account's rows are already stored here (a pull wrote them) when the
  // merge runs; accountIds says which rows came from the account.
  test('joins same-named glazes and clays', async () => {
    await quietly(db, async () => {
      await db.clays.bulkAdd([
        { id: 'lc', name: 'White stoneware', updatedAt: T1 },
        { id: 'ac', name: 'White stoneware', updatedAt: T2 },
        { id: 'lc2', name: 'Red', updatedAt: T1 },
      ])
      await db.glazes.bulkAdd([
        glaze('lg', ' shino'),
        glaze('ag', 'Shino', { updatedAt: T2 }),
        glaze('lg2', 'Celadon'),
      ])
      await db.pieces.bulkAdd([
        piece('p1', { clayId: 'lc' }),
        piece('p2', { clayId: 'lc2' }),
      ])
      await db.glazeApps.bulkAdd([
        {
          id: 'a1',
          entryId: 'e1',
          pieceId: 'p1',
          glazeId: 'lg',
          order: 0,
          updatedAt: T1,
        },
        {
          id: 'a2',
          entryId: 'e1',
          pieceId: 'p1',
          glazeId: 'lg2',
          order: 1,
          updatedAt: T1,
        },
      ])
      await db.settings.add({
        id: 'app',
        defaultCone: '6',
        bisqueNote: 'b',
        firedNote: 'f',
        defaultClayId: 'lc',
        updatedAt: T1,
      })
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set(['ac']) })

    expect(await db.pieces.get('p1')).toMatchObject({
      clayId: 'ac',
      updatedAt: '2026-01-01T00:00:00.001Z',
      dirty: 1,
    })
    expect(await db.pieces.get('p2')).toMatchObject({
      clayId: 'lc2',
      updatedAt: T1,
    })
    expect(await db.glazeApps.get('a1')).toMatchObject({
      glazeId: 'ag',
      dirty: 1,
    })
    expect((await db.glazeApps.get('a2'))?.glazeId).toBe('lg2')
    expect(await db.settings.get('app')).toMatchObject({
      defaultClayId: 'ac',
      dirty: 1,
    })
    for (const [table, id] of [
      [db.clays, 'lc'],
      [db.glazes, 'lg'],
    ] as const) {
      const row = await table.get(id)
      expect(row?.deletedAt).toBeTruthy()
      expect(row?.dirty).toBe(1)
    }
    expect((await db.clays.get('ac'))?.deletedAt).toBeUndefined()
    expect((await db.glazes.get('lg2'))?.deletedAt).toBeUndefined()
  })

  test('a moved piece changes 1 ms after its last change, deleted or not', async () => {
    await quietly(db, async () => {
      await db.clays.bulkAdd([
        { id: 'lc', name: 'Porcelain', updatedAt: T1 },
        { id: 'ac', name: 'Porcelain', updatedAt: T1 },
      ])
      await db.pieces.bulkAdd([
        piece('no-time', { clayId: 'lc', updatedAt: undefined }),
        piece('garbled', { clayId: 'lc', updatedAt: 'garbage' }),
        piece('deleted', { clayId: 'lc', updatedAt: T1, deletedAt: T2 }),
      ])
    })

    await mergeByName(db, { glaze: new Set(), clay: new Set(['ac']) })

    expect(await db.pieces.get('no-time')).toMatchObject({
      clayId: 'ac',
      updatedAt: '1970-01-01T00:00:00.001Z',
    })
    expect((await db.pieces.get('garbled'))?.updatedAt).toBe(
      '1970-01-01T00:00:00.001Z',
    )
    const deleted = await db.pieces.get('deleted')
    expect(deleted).toMatchObject({ clayId: 'ac', deletedAt: T2 })
    expect(changedAt(deleted ?? {})).toBe('2026-02-01T00:00:00.001Z')
  })

  test('leaves a deleted account row alone', async () => {
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino'),
        glaze('ag', 'Shino', { updatedAt: T2, deletedAt: T2 }),
      ])
    })
    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })
    expect((await db.glazes.get('lg'))?.deletedAt).toBeUndefined()
  })

  const details = { color: '#aa0000', cone: '10', notes: 'Runs on verticals' }

  test("the merge keeps this device's later glaze details", async () => {
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', ' shino', { ...details, updatedAt: T3 }),
        glaze('ag', 'Shino', {
          color: DEFAULT_GLAZE_COLOR,
          cone: '6',
          updatedAt: T2,
        }),
      ])
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    const merged = await db.glazes.get('ag')
    expect(merged).toMatchObject({ name: 'Shino', ...details, dirty: 1 })
    expect(merged?.deletedAt).toBeUndefined()
    expect(changedAt(merged ?? {}) > T3).toBe(true)
    expect((await db.glazes.get('lg'))?.deletedAt).toBeTruthy()
  })

  test('on a tie the merge fills in what the account glaze lacks', async () => {
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', 'shino', { ...details, updatedAt: T2 }),
        glaze('ag', 'Shino', {
          color: DEFAULT_GLAZE_COLOR,
          cone: '6',
          updatedAt: T2,
        }),
        glaze('lg2', 'Celadon', { ...details, updatedAt: T2 }),
        glaze('ag2', 'Celadon', { color: '#00aa00', notes: '', updatedAt: T2 }),
      ])
    })

    await mergeByName(db, {
      glaze: new Set(['ag', 'ag2']),
      clay: new Set(),
    })

    // Its own cone stays; the default color and missing notes are filled.
    expect(await db.glazes.get('ag')).toMatchObject({
      name: 'Shino',
      color: '#aa0000',
      cone: '6',
      notes: 'Runs on verticals',
      dirty: 1,
    })
    // Its own color stays; the missing cone and empty notes are filled.
    expect(await db.glazes.get('ag2')).toMatchObject({
      name: 'Celadon',
      color: '#00aa00',
      cone: '10',
      notes: 'Runs on verticals',
      dirty: 1,
    })
  })

  test('the merge keeps the account glaze when it changed later', async () => {
    const account = glaze('ag', 'Shino', {
      color: DEFAULT_GLAZE_COLOR,
      updatedAt: T3,
    })
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino', { ...details, updatedAt: T2 }),
        account,
      ])
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    expect(await db.glazes.get('ag')).toEqual(account)
    expect((await db.glazes.get('lg'))?.deletedAt).toBeTruthy()
  })

  const swatchPhoto = (id: string): Photo => ({
    id,
    hash: id.padEnd(64, '0'),
    width: 600,
    height: 600,
    takenAt: T1,
    swatch: 1,
    updatedAt: T1,
  })

  test('mergeByName carries a local swatch onto an account glaze that has none, even when the account glaze changed later', async () => {
    await quietly(db, async () => {
      await db.photos.add(swatchPhoto('sw1'))
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino', {
          ...details,
          swatchPhotoId: 'sw1',
          updatedAt: T2,
        }),
        glaze('ag', 'Shino', {
          color: '#00aa00',
          cone: '6',
          updatedAt: T3,
        }),
      ])
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    // The swatch and its color come over; the account's other details stay.
    const merged = await db.glazes.get('ag')
    expect(merged).toMatchObject({
      swatchPhotoId: 'sw1',
      color: '#aa0000',
      cone: '6',
      dirty: 1,
    })
    expect(merged?.notes).toBeUndefined()
    expect((await db.glazes.get('lg'))?.deletedAt).toBeTruthy()
    expect((await db.photos.get('sw1'))?.deletedAt).toBeUndefined()
  })

  test('mergeByName dates a carried swatch past an account glaze dated in the future', async () => {
    const future = '2099-01-01T00:00:00.000Z'
    await quietly(db, async () => {
      await db.photos.add(swatchPhoto('sw1'))
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino', {
          ...details,
          swatchPhotoId: 'sw1',
          updatedAt: T2,
        }),
        glaze('ag', 'Shino', {
          color: '#00aa00',
          cone: '6',
          updatedAt: future,
        }),
      ])
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    const merged = await db.glazes.get('ag')
    expect(merged?.swatchPhotoId).toBe('sw1')
    expect((merged?.updatedAt ?? '') > future).toBe(true)
  })

  test("mergeByName keeps an account glaze's swatch and its color when the newer local glaze has none", async () => {
    await quietly(db, async () => {
      await db.photos.add(swatchPhoto('asw'))
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino', { ...details, updatedAt: T3 }),
        glaze('ag', 'Shino', {
          color: '#00aa00',
          swatchPhotoId: 'asw',
          updatedAt: T2,
        }),
      ])
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    // Its other details still come from the newer local glaze.
    expect(await db.glazes.get('ag')).toMatchObject({
      swatchPhotoId: 'asw',
      color: '#00aa00',
      cone: '10',
      notes: 'Runs on verticals',
    })
    expect((await db.photos.get('asw'))?.deletedAt).toBeUndefined()
  })

  test("mergeByName with swatches on both keeps the newer and deletes the other's photo", async () => {
    await quietly(db, async () => {
      await db.photos.bulkAdd([
        swatchPhoto('lsw'),
        swatchPhoto('asw'),
        swatchPhoto('lsw2'),
        swatchPhoto('asw2'),
      ])
      await db.glazes.bulkAdd([
        // This device's changed later.
        glaze('lg', 'Shino', {
          color: '#aa0000',
          swatchPhotoId: 'lsw',
          updatedAt: T3,
        }),
        glaze('ag', 'Shino', {
          color: '#00aa00',
          swatchPhotoId: 'asw',
          updatedAt: T2,
        }),
        // The account's changed later.
        glaze('lg2', 'Celadon', {
          color: '#aa0000',
          swatchPhotoId: 'lsw2',
          updatedAt: T2,
        }),
        glaze('ag2', 'Celadon', {
          color: '#00aa00',
          swatchPhotoId: 'asw2',
          updatedAt: T3,
        }),
      ])
    })

    await mergeByName(db, {
      glaze: new Set(['ag', 'ag2']),
      clay: new Set(),
    })

    expect(await db.glazes.get('ag')).toMatchObject({
      swatchPhotoId: 'lsw',
      color: '#aa0000',
    })
    expect(await db.glazes.get('ag2')).toMatchObject({
      swatchPhotoId: 'asw2',
      color: '#00aa00',
    })
    for (const id of ['lsw', 'asw2']) {
      expect((await db.photos.get(id))?.deletedAt).toBeUndefined()
    }
    for (const id of ['asw', 'lsw2']) {
      const row = await db.photos.get(id)
      expect(row?.deletedAt).toBeTruthy()
      expect(row?.dirty).toBe(1)
    }
  })

  test("a piece's plan moves to the account's glaze too", async () => {
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('lg', ' shino'),
        glaze('ag', 'Shino', { updatedAt: T2 }),
      ])
      await db.pieces.add(
        piece('p', {
          glazePlan: [{ glazeId: 'lg', dips: 2 }, { glazeId: 'other' }],
        }),
      )
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set() })

    const row = await db.pieces.get('p')
    expect(row?.glazePlan).toEqual([
      { glazeId: 'ag', dips: 2 },
      { glazeId: 'other' },
    ])
    expect(row?.updatedAt).toBe('2026-01-01T00:00:00.001Z')
    expect(row?.dirty).toBe(1)
  })

  test('a piece needing both a clay and a plan rewrite keeps both', async () => {
    await quietly(db, async () => {
      await db.clays.bulkAdd([
        { id: 'lc', name: 'Red', updatedAt: T1 },
        { id: 'ac', name: 'Red', updatedAt: T2 },
      ])
      await db.glazes.bulkAdd([
        glaze('lg', 'Shino'),
        glaze('ag', 'Shino', { updatedAt: T2 }),
      ])
      await db.pieces.add(
        piece('p', { clayId: 'lc', glazePlan: [{ glazeId: 'lg' }] }),
      )
    })

    await mergeByName(db, { glaze: new Set(['ag']), clay: new Set(['ac']) })

    expect(await db.pieces.get('p')).toMatchObject({
      clayId: 'ac',
      glazePlan: [{ glazeId: 'ag' }],
      updatedAt: '2026-01-01T00:00:00.001Z',
      dirty: 1,
    })
  })
})

describe('combos', () => {
  const comboRecord = (id: string, changed: string): SyncRecord => ({
    kind: 'combo',
    id,
    changedAt: changed,
    data: {
      id,
      layers: ['g1', 'g2'],
      swatchPhotoId: 'ph1',
      updatedAt: changed,
    },
  })

  test('a combo pushes and pulls like a glaze', async () => {
    const id = comboId(['g1', 'g2'])
    await db.combos.add({ id, layers: ['g1', 'g2'], swatchPhotoId: 'ph1' })
    expect(await db.combos.get(id)).toMatchObject({ dirty: 1 })
    expect(
      (await readDirty(db)).filter((r) => r.kind === 'combo').map((r) => r.id),
    ).toEqual([id])
    await clearDirty(db, await readDirty(db))
    await db.combos.update(id, { deletedAt: T2 })
    expect((await readDirty(db)).map((r) => r.kind)).toEqual(['combo'])

    await applyRecords(db, [comboRecord('combo-x', T2)])
    expect(await db.combos.get('combo-x')).toMatchObject({
      layers: ['g1', 'g2'],
      swatchPhotoId: 'ph1',
      updatedAt: T2,
    })
    expect((await db.combos.get('combo-x'))?.dirty).toBeUndefined()
  })

  const stored = (id: string, layers: string[], photo: string) => ({
    id,
    layers,
    swatchPhotoId: photo,
    createdAt: T1,
    updatedAt: T1,
  })

  const photoFor = (id: string, photo: string, changed: string) => ({
    ...comboRecord(id, changed),
    data: { ...comboRecord(id, changed).data, swatchPhotoId: photo },
  })

  test('a pulled combo with another photo releases the local one', async () => {
    const id = comboId(['g1', 'g2'])
    await quietly(db, async () => {
      await db.photos.add(photoRow('phA', { swatch: 1 }))
      await db.combos.add(stored(id, ['g1', 'g2'], 'phA'))
    })
    await applyRecords(db, [photoFor(id, 'phB', T2)])
    expect((await db.combos.get(id))?.swatchPhotoId).toBe('phB')
    const released = await db.photos.get('phA')
    expect(released?.deletedAt).toBeTruthy()
    // A tracked change, so the delete reaches the other devices.
    expect(released?.dirty).toBe(1)
    expect(released?.updatedAt && released.updatedAt > T1).toBe(true)
  })

  test('a pulled combo with the same photo keeps it', async () => {
    const id = comboId(['g1', 'g2'])
    await quietly(db, async () => {
      await db.photos.add(photoRow('phA', { swatch: 1 }))
      await db.combos.add(stored(id, ['g1', 'g2'], 'phA'))
    })
    await applyRecords(db, [photoFor(id, 'phA', T2)])
    expect(await db.photos.get('phA')).toEqual(photoRow('phA', { swatch: 1 }))
  })

  test('a pulled combo keeps a replaced photo a glaze still links', async () => {
    const id = comboId(['g1', 'g2'])
    await quietly(db, async () => {
      await db.glazes.add(glaze('g3', 'Chun', { swatchPhotoId: 'phA' }))
      await db.photos.add(photoRow('phA', { swatch: 1 }))
      await db.combos.add(stored(id, ['g1', 'g2'], 'phA'))
    })
    await applyRecords(db, [photoFor(id, 'phB', T2)])
    expect((await db.photos.get('phA'))?.deletedAt).toBeUndefined()
  })

  test('an older pulled combo leaves the local photo alone', async () => {
    const id = comboId(['g1', 'g2'])
    await quietly(db, async () => {
      await db.photos.add(photoRow('phA', { swatch: 1 }))
      await db.combos.add({ ...stored(id, ['g1', 'g2'], 'phA'), updatedAt: T3 })
    })
    await applyRecords(db, [photoFor(id, 'phB', T2)])
    expect((await db.combos.get(id))?.swatchPhotoId).toBe('phA')
    expect((await db.photos.get('phA'))?.deletedAt).toBeUndefined()
  })

  test("first sign-in moves combos onto the account's glazes", async () => {
    const old = comboId(['X', 'L'])
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('L', 'Tenmoku'),
        glaze('A', 'tenmoku', { updatedAt: T2 }),
      ])
      await db.photos.add(photoRow('ph1', { swatch: 1 }))
      await db.combos.add(stored(old, ['X', 'L'], 'ph1'))
    })
    await mergeByName(db, { glaze: new Set(['A']), clay: new Set() })
    expect(await db.combos.get(comboId(['X', 'A']))).toMatchObject({
      layers: ['X', 'A'],
      swatchPhotoId: 'ph1',
      dirty: 1,
    })
    expect(
      (await db.combos.get(comboId(['X', 'A'])))?.deletedAt,
    ).toBeUndefined()
    expect((await db.combos.get(old))?.deletedAt).toBeTruthy()
    expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
  })

  test("first sign-in keeps the account's combo when it changed later", async () => {
    const old = comboId(['X', 'L'])
    const kept = comboId(['X', 'A'])
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('L', 'Tenmoku'),
        glaze('A', 'tenmoku', { updatedAt: T2 }),
      ])
      await db.photos.bulkAdd([
        photoRow('ph1', { swatch: 1 }),
        photoRow('ph2', { swatch: 1 }),
      ])
      await db.combos.bulkAdd([
        stored(old, ['X', 'L'], 'ph1'),
        { ...stored(kept, ['X', 'A'], 'ph2'), updatedAt: T2 },
      ])
    })
    await mergeByName(db, { glaze: new Set(['A']), clay: new Set() })
    expect(await db.combos.get(kept)).toMatchObject({
      swatchPhotoId: 'ph2',
      updatedAt: T2,
    })
    expect((await db.combos.get(kept))?.deletedAt).toBeUndefined()
    expect((await db.combos.get(old))?.deletedAt).toBeTruthy()
    expect((await db.photos.get('ph1'))?.deletedAt).toBeTruthy()
    expect((await db.photos.get('ph2'))?.deletedAt).toBeUndefined()
  })

  test("first sign-in keeps the local combo's photo when it changed later", async () => {
    const old = comboId(['X', 'L'])
    const kept = comboId(['X', 'A'])
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('L', 'Tenmoku'),
        glaze('A', 'tenmoku', { updatedAt: T2 }),
      ])
      await db.photos.bulkAdd([
        photoRow('ph1', { swatch: 1 }),
        photoRow('ph2', { swatch: 1 }),
      ])
      await db.combos.bulkAdd([
        { ...stored(old, ['X', 'L'], 'ph1'), updatedAt: T2 },
        stored(kept, ['X', 'A'], 'ph2'),
      ])
    })
    await mergeByName(db, { glaze: new Set(['A']), clay: new Set() })
    const combo = await db.combos.get(kept)
    expect(combo).toMatchObject({
      layers: ['X', 'A'],
      swatchPhotoId: 'ph1',
      createdAt: T1,
      dirty: 1,
    })
    expect(combo?.deletedAt).toBeUndefined()
    expect((combo?.updatedAt ?? '') > T2).toBe(true)
    expect((await db.combos.get(old))?.deletedAt).toBeTruthy()
    expect((await db.photos.get('ph1'))?.deletedAt).toBeUndefined()
    expect((await db.photos.get('ph2'))?.deletedAt).toBeTruthy()
  })

  test('first sign-in dates a combo it revives after its delete', async () => {
    const FUTURE = '2099-01-01T00:00:00.000Z'
    const old = comboId(['X', 'L'])
    const target = comboId(['X', 'A'])
    await quietly(db, async () => {
      await db.glazes.bulkAdd([
        glaze('L', 'Tenmoku'),
        glaze('A', 'tenmoku', { updatedAt: T2 }),
      ])
      await db.photos.bulkAdd([
        photoRow('ph1', { swatch: 1 }),
        photoRow('ph2', { swatch: 1, deletedAt: FUTURE }),
      ])
      await db.combos.bulkAdd([
        stored(old, ['X', 'L'], 'ph1'),
        {
          ...stored(target, ['X', 'A'], 'ph2'),
          deletedAt: FUTURE,
          updatedAt: FUTURE,
        },
      ])
    })
    await mergeByName(db, { glaze: new Set(['A']), clay: new Set() })
    const combo = await db.combos.get(target)
    expect(combo).toMatchObject({ swatchPhotoId: 'ph1', dirty: 1 })
    expect(combo?.deletedAt).toBeUndefined()
    expect(combo?.updatedAt).toBe('2099-01-01T00:00:00.001Z')
  })
})
