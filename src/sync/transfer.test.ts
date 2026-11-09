import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GlazetteDB } from '../db/db'
import type { Photo } from '../db/types'
import { sha256 } from '../photos/hash'
import { SyncStopped } from './engine'
import type { PhotoTransport } from './photoTransport'
import { createTestPhotoServer } from './testPhotoServer'
import { onLocalChange, quietly } from './track'
import { transferPhotos } from './transfer'

// fake-indexeddb hands stored Blobs back as plain objects with the bytes lost,
// which a real browser never does. So a test keeps the real Blobs here and a
// read hook puts them back on the rows, as a browser would return them.
const held = new Map<string, { blob: Blob; thumb: Blob }>()

function watch(db: GlazetteDB) {
  db.photos.hook('reading', (row: Photo) => {
    const bytes = held.get(row.id)
    return bytes && row.blob ? { ...row, ...bytes } : row
  })
}

const T1 = '2026-01-01T00:00:00.000Z'

/** A photo row holding real bytes, kept for the read hook. */
async function withBytes(
  id: string,
  text: string,
  extra: Partial<Photo> = {},
): Promise<Photo> {
  const blob = new Blob([text], { type: 'image/jpeg' })
  const thumb = new Blob([`thumb ${text}`], { type: 'image/jpeg' })
  held.set(id, { blob, thumb })
  return {
    id,
    hash: await sha256(blob),
    width: 10,
    height: 10,
    takenAt: T1,
    blob,
    thumb,
    ...extra,
  }
}

/** The details of a photo whose bytes are elsewhere. */
async function withoutBytes(
  id: string,
  text: string,
  extra: Partial<Photo> = {},
): Promise<Photo> {
  const hash = await sha256(new Blob([text]))
  return {
    id,
    hash,
    width: 10,
    height: 10,
    takenAt: T1,
    needsDownload: 1,
    ...extra,
  }
}

/** Puts rows in exactly as given: not marked dirty, not reported as changes. */
function seed(db: GlazetteDB, rows: Photo[]) {
  return quietly(db, () => db.photos.bulkPut(rows))
}

/** Puts the bytes of `text` on the server, as another device would have. */
async function serverHolds(server: PhotoTransport, text: string) {
  const blob = new Blob([text], { type: 'image/jpeg' })
  const thumb = new Blob([`thumb ${text}`], { type: 'image/jpeg' })
  const hash = await sha256(blob)
  await server.upload(hash, 'full', blob, hash)
  await server.upload(hash, 'thumb', thumb, await sha256(thumb))
  return hash
}

let name: string
let db: GlazetteDB
let server: ReturnType<typeof createTestPhotoServer>

beforeEach(async () => {
  name = `transfer-${crypto.randomUUID()}`
  db = new GlazetteDB(name)
  await db.open()
  watch(db)
  server = createTestPhotoServer()
})

afterEach(async () => {
  vi.restoreAllMocks()
  held.clear()
  await db.delete()
})

test('waiting photos upload and stop waiting', async () => {
  const a = await withBytes('a', 'clay one', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [a, b])
  expect(await transferPhotos(db, server)).toBe('done')
  for (const photo of [a, b]) {
    expect(server.files().has(`full/${photo.hash}`)).toBe(true)
    expect(server.files().has(`thumb/${photo.hash}`)).toBe(true)
  }
  expect(await db.photos.where('needsUpload').equals(1).count()).toBe(0)
})

test("a photo the server already has isn't sent again", async () => {
  const hash = await serverHolds(server, 'clay one')
  await seed(db, [await withBytes('a', 'clay one', { needsUpload: 1 })])
  const upload = vi.spyOn(server, 'upload')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(upload).not.toHaveBeenCalled()
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
  expect(server.files().has(`full/${hash}`)).toBe(true)
})

test('a waiting photo without bytes just stops waiting', async () => {
  await seed(db, [
    await withoutBytes('a', 'clay one', {
      needsDownload: undefined,
      needsUpload: 1,
    }),
  ])
  const missing = vi.spyOn(server, 'missing')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(missing).not.toHaveBeenCalled()
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
})

test('a deleted photo still uploads when waiting', async () => {
  const a = await withBytes('a', 'clay one', { needsUpload: 1, deletedAt: T1 })
  await seed(db, [a])
  expect(await transferPhotos(db, server)).toBe('done')
  expect(server.files().has(`full/${a.hash}`)).toBe(true)
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
})

test('a waiting photo survives closing the app', async () => {
  await seed(db, [await withBytes('a', 'clay one', { needsUpload: 1 })])
  const offline: PhotoTransport = {
    ...server,
    upload: async () => {
      throw new SyncStopped('offline')
    },
  }
  expect(await transferPhotos(db, offline)).toBe('offline')
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)

  db.close()
  db = new GlazetteDB(name)
  await db.open()
  watch(db)
  expect(await transferPhotos(db, server)).toBe('done')
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
  expect(server.files().size).toBe(2)
})

test("a refused upload doesn't hold up the others", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const a = await withBytes('a', 'clay one', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [a, b])
  const refusing: PhotoTransport = {
    ...server,
    upload: async (hash, part, bytes, sum) =>
      hash === a.hash ? 'refused' : server.upload(hash, part, bytes, sum),
  }
  expect(await transferPhotos(db, refusing)).toBe('done')
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b'))?.needsUpload).toBeUndefined()
  expect(server.files().has(`full/${b.hash}`)).toBe(true)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a photo is downloaded and verified', async () => {
  await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one')])
  expect(await transferPhotos(db, server)).toBe('done')
  const row = await db.photos.get('a')
  expect(row?.blob).toBeDefined()
  expect(row?.thumb).toBeDefined()
  expect(row?.needsDownload).toBeUndefined()
})

test('a missing thumbnail falls back to the full image', async () => {
  const hash = await serverHolds(server, 'clay one')
  server.files().delete(`thumb/${hash}`)
  await seed(db, [await withoutBytes('a', 'clay one')])
  expect(await transferPhotos(db, server)).toBe('done')
  const row = await db.photos.get('a')
  expect(row?.blob).toBeDefined()
  expect(row?.thumb).toBeDefined()
  expect(row?.needsDownload).toBeUndefined()
})

test('a corrupted download is thrown away', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one')])
  const corrupting: PhotoTransport = {
    ...server,
    download: async () => new Blob(['something else']),
  }
  expect(await transferPhotos(db, corrupting)).toBe('done')
  const row = await db.photos.get('a')
  expect(row?.blob).toBeUndefined()
  expect(row?.needsDownload).toBe(1)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a photo not uploaded yet waits quietly', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await seed(db, [await withoutBytes('a', 'clay one')])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).toHaveBeenCalledTimes(1)
  const row = await db.photos.get('a')
  expect(row?.blob).toBeUndefined()
  expect(row?.needsDownload).toBe(1)
  expect(error).not.toHaveBeenCalled()
})

test('an image already here under another id is copied, not downloaded', async () => {
  const here = await withBytes('a', 'clay one')
  await seed(db, [here, await withoutBytes('b', 'clay one')])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).not.toHaveBeenCalled()
  const row = await db.photos.get('b')
  expect(row?.blob).toBeDefined()
  expect(row?.thumb).toBeDefined()
  expect(row?.needsDownload).toBeUndefined()
})

test('a photo that already has its bytes just stops waiting for them', async () => {
  const a = await withBytes('a', 'clay one', { needsDownload: 1 })
  await seed(db, [a])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).not.toHaveBeenCalled()
  expect((await db.photos.get('a'))?.needsDownload).toBeUndefined()
})

test("a deleted photo isn't downloaded", async () => {
  await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one', { deletedAt: T1 })])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).not.toHaveBeenCalled()
  expect((await db.photos.get('a'))?.blob).toBeUndefined()
})

test('a stopped transfer returns its reason and keeps what is done', async () => {
  await serverHolds(server, 'clay one')
  await seed(db, [
    await withoutBytes('a', 'clay one'),
    await withoutBytes('b', 'clay two'),
  ])
  const signedOut: PhotoTransport = {
    ...server,
    download: async (hash, part) => {
      if (hash === (await sha256(new Blob(['clay two']))))
        throw new SyncStopped('signed-out')
      return server.download(hash, part)
    },
  }
  expect(await transferPhotos(db, signedOut)).toBe('signed-out')
  expect((await db.photos.get('a'))?.blob).toBeDefined()
  expect((await db.photos.get('b'))?.needsDownload).toBe(1)
})

test('anything unexpected is an error', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await seed(db, [await withBytes('a', 'clay one', { needsUpload: 1 })])
  const broken: PhotoTransport = {
    ...server,
    missing: async () => {
      throw new Error('boom')
    },
  }
  expect(await transferPhotos(db, broken)).toBe('error')
  expect(error).toHaveBeenCalledTimes(1)
})

test('transfers never mark rows as changed', async () => {
  await serverHolds(server, 'clay two')
  await seed(db, [
    await withBytes('a', 'clay one', { needsUpload: 1 }),
    await withoutBytes('b', 'clay two'),
  ])
  const heard = vi.fn()
  const unsubscribe = onLocalChange(db, heard)
  expect(await transferPhotos(db, server)).toBe('done')
  await new Promise((resolve) => setTimeout(resolve, 0))
  unsubscribe()
  expect(heard).not.toHaveBeenCalled()
  expect(await db.photos.where('dirty').equals(1).count()).toBe(0)
  expect((await db.photos.get('b'))?.blob).toBeDefined()
})
