import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GlazetteDB } from '../db/db'
import type { Photo } from '../db/types'
import { moveBytesApart } from '../photos/bytes'
import { sha256 } from '../photos/hash'
import { realBlobs } from '../test/realBlobs'
import { SyncStopped } from './engine'
import type { PhotoTransport } from './photoTransport'
import { createTestPhotoServer } from './testPhotoServer'
import { onLocalChange, quietly } from './track'
import { transferPhotos } from './transfer'

// Hands back real Blobs where fake-indexeddb would lose their bytes.
let real: ReturnType<typeof realBlobs>

const T1 = '2026-01-01T00:00:00.000Z'

/** A photo row from before the move, its bytes still on it. */
async function withBytes(
  id: string,
  text: string,
  extra: Partial<Photo> = {},
): Promise<Photo> {
  const blob = new Blob([text], { type: 'image/jpeg' })
  const thumb = new Blob([`thumb ${text}`], { type: 'image/jpeg' })
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

/** The details of a photo whose bytes are in the table, and those bytes. */
async function stored(
  id: string,
  text: string,
  extra: Partial<Photo> = {},
): Promise<Photo> {
  const blob = new Blob([text], { type: 'image/jpeg' })
  const thumb = new Blob([`thumb ${text}`], { type: 'image/jpeg' })
  const hash = await sha256(blob)
  if (!(await db.photoBytes.get(hash))) {
    await quietly(db, () => db.photoBytes.add({ hash, blob, thumb }))
  }
  return {
    ...(await withoutBytes(id, text)),
    needsDownload: undefined,
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
  real = realBlobs()
  real.watch(db)
  server = createTestPhotoServer()
})

afterEach(async () => {
  vi.restoreAllMocks()
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

test('bytes in the table upload, full and thumbnail', async () => {
  const a = await stored('a', 'clay one', { needsUpload: 1 })
  await seed(db, [a])
  expect(await transferPhotos(db, server)).toBe('done')
  const entry = real.inTable.get(a.hash)
  expect(server.files().get(`full/${a.hash}`)).toBe(entry?.blob)
  expect(server.files().get(`thumb/${a.hash}`)).toBe(entry?.thumb)
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
})

test('rows sharing a hash upload it once, and all stop waiting', async () => {
  const a = await stored('a', 'clay one', { needsUpload: 1 })
  const b = await stored('b', 'clay one', { needsUpload: 1 })
  await seed(db, [a, b])
  const upload = vi.spyOn(server, 'upload')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(upload).toHaveBeenCalledTimes(2)
  expect(await db.photos.where('needsUpload').equals(1).count()).toBe(0)
})

test('a row keeps waiting while the only bytes are on a row not moved yet', async () => {
  const dup = await withBytes('dup', 'clay one', {
    deletedAt: T1,
    mergedInto: 'kept',
  })
  await seed(db, [
    await withoutBytes('kept', 'clay one', {
      needsDownload: undefined,
      needsUpload: 1,
    }),
    dup,
  ])
  expect(await transferPhotos(db, server)).toBe('done')
  expect((await db.photos.get('kept'))?.needsUpload).toBe(1)
  expect(server.files().size).toBe(0)

  // Once the move succeeds, the row kept uploads the image.
  await moveBytesApart(db)
  expect(await transferPhotos(db, server)).toBe('done')
  expect((await db.photos.get('kept'))?.needsUpload).toBeUndefined()
  expect(server.files().get(`full/${dup.hash}`)).toBe(dup.blob)
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
  real.watch(db)
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

test("one photo that throws doesn't stop the other uploads", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const a = await withBytes('a', 'clay one', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [a, b])
  const breaking: PhotoTransport = {
    ...server,
    upload: async (hash, part, bytes, sum) => {
      if (hash === a.hash) throw new Error('boom')
      return server.upload(hash, part, bytes, sum)
    },
  }
  expect(await transferPhotos(db, breaking)).toBe('error')
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b'))?.needsUpload).toBeUndefined()
  expect(server.files().has(`full/${b.hash}`)).toBe(true)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a signed-out upload still stops everything at once', async () => {
  const a = await withBytes('a', 'clay one', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [a, b])
  const upload = vi.fn(async () => {
    throw new SyncStopped('signed-out')
  })
  expect(await transferPhotos(db, { ...server, upload })).toBe('signed-out')
  expect(upload).toHaveBeenCalledTimes(1)
})

test("one download that throws doesn't stop the other downloads", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await serverHolds(server, 'clay one')
  const hashTwo = await serverHolds(server, 'clay two')
  await seed(db, [
    await withoutBytes('a', 'clay one'),
    await withoutBytes('b', 'clay two'),
  ])
  const breaking: PhotoTransport = {
    ...server,
    download: async (hash, part) => {
      if (hash !== hashTwo) throw new Error('boom')
      return server.download(hash, part)
    },
  }
  expect(await transferPhotos(db, breaking)).toBe('error')
  expect((await db.photos.get('a'))?.needsDownload).toBe(1)
  expect((await db.photos.get('b'))?.needsDownload).toBeUndefined()
  expect(await db.photoBytes.count()).toBe(1)
  expect(error).toHaveBeenCalledTimes(1)
})

test('the thumbnail uploads first, and the full image is tried when it is refused', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const a = await stored('a', 'clay one', { needsUpload: 1 })
  await seed(db, [a])
  const parts: string[] = []
  const refusingThumb: PhotoTransport = {
    ...server,
    upload: async (hash, part, bytes, sum) => {
      parts.push(part)
      return part === 'thumb'
        ? 'refused'
        : server.upload(hash, part, bytes, sum)
    },
  }
  expect(await transferPhotos(db, refusingThumb)).toBe('done')
  expect(parts).toEqual(['thumb', 'full'])
  expect(server.files().has(`full/${a.hash}`)).toBe(true)
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a photo whose bytes have no thumbnail is logged and skipped', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const blob = new Blob(['clay one'], { type: 'image/jpeg' })
  const hash = await sha256(blob)
  await quietly(db, () => db.photoBytes.add({ hash, blob }))
  await seed(db, [await stored('a', 'clay one', { needsUpload: 1 })])
  expect(await transferPhotos(db, server)).toBe('done')
  expect(server.files().size).toBe(0)
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a downloaded row does not wait to upload', async () => {
  await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one')])
  expect(await transferPhotos(db, server)).toBe('done')
  expect((await db.photos.get('a'))?.needsUpload).toBeUndefined()
})

test('a photo is downloaded, verified and kept in the table', async () => {
  const hash = await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one')])
  expect(await transferPhotos(db, server)).toBe('done')
  const row = await db.photos.get('a')
  expect(row).not.toHaveProperty('blob')
  expect(row).not.toHaveProperty('thumb')
  expect(row?.needsDownload).toBeUndefined()
  const entry = real.inTable.get(hash)
  expect(entry?.blob).toBe(server.files().get(`full/${hash}`))
  expect(entry?.thumb).toBe(server.files().get(`thumb/${hash}`))
})

test('a downloaded image clears every row with that hash', async () => {
  const hash = await serverHolds(server, 'clay one')
  await seed(db, [
    await withoutBytes('a', 'clay one'),
    await withoutBytes('b', 'clay one'),
    await withoutBytes('c', 'clay one', { deletedAt: T1 }),
    await withoutBytes('other', 'clay two'),
  ])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  // The full image and thumbnail once, plus the look for the other photo.
  expect(download.mock.calls.filter(([h]) => h === hash)).toHaveLength(2)
  for (const id of ['a', 'b', 'c']) {
    expect((await db.photos.get(id))?.needsDownload).toBeUndefined()
  }
  expect((await db.photos.get('other'))?.needsDownload).toBe(1)
  expect(await db.photoBytes.count()).toBe(1)
})

test('a missing thumbnail falls back to the full image', async () => {
  const hash = await serverHolds(server, 'clay one')
  server.files().delete(`thumb/${hash}`)
  await seed(db, [await withoutBytes('a', 'clay one')])
  expect(await transferPhotos(db, server)).toBe('done')
  const entry = real.inTable.get(hash)
  expect(entry?.thumb).toBe(entry?.blob)
  expect(entry?.blob).toBeDefined()
  expect((await db.photos.get('a'))?.needsDownload).toBeUndefined()
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
  expect((await db.photos.get('a'))?.needsDownload).toBe(1)
  expect(await db.photoBytes.count()).toBe(0)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a photo not uploaded yet waits quietly', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await seed(db, [await withoutBytes('a', 'clay one')])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).toHaveBeenCalledTimes(1)
  expect((await db.photos.get('a'))?.needsDownload).toBe(1)
  expect(await db.photoBytes.count()).toBe(0)
  expect(error).not.toHaveBeenCalled()
})

test("an image already in the table isn't downloaded", async () => {
  const b = await stored('b', 'clay one', { needsDownload: 1 })
  const before = real.inTable.get(b.hash)
  await seed(db, [b])
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(download).not.toHaveBeenCalled()
  expect((await db.photos.get('b'))?.needsDownload).toBeUndefined()
  expect(real.inTable.get(b.hash)).toBe(before)
})

test("a download that finds the image arrived meanwhile doesn't overwrite it", async () => {
  const hash = await serverHolds(server, 'clay one')
  await seed(db, [await withoutBytes('a', 'clay one')])
  const first = new Blob(['clay one'], { type: 'image/jpeg' })
  const arriving: PhotoTransport = {
    ...server,
    download: async (h, part) => {
      if (!(await db.photoBytes.get(h))) {
        await quietly(db, () => db.photoBytes.add({ hash: h, blob: first }))
      }
      return server.download(h, part)
    },
  }
  expect(await transferPhotos(db, arriving)).toBe('done')
  expect(real.inTable.get(hash)?.blob).toBe(first)
  expect((await db.photos.get('a'))?.needsDownload).toBeUndefined()
})

test('a row waiting to download whose twin holds bytes on its row still downloads', async () => {
  const hash = await serverHolds(server, 'clay one')
  await seed(db, [
    await withBytes('here', 'clay one'),
    await withoutBytes('waiting', 'clay one'),
  ])
  expect(await transferPhotos(db, server)).toBe('done')
  expect((await db.photos.get('waiting'))?.needsDownload).toBeUndefined()
  expect(real.inTable.has(hash)).toBe(true)
  expect((await db.photos.get('here'))?.blob).toBeDefined()
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
  expect(await db.photoBytes.count()).toBe(0)
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
  expect((await db.photos.get('a'))?.needsDownload).toBeUndefined()
  expect(await db.photoBytes.count()).toBe(1)
  expect((await db.photos.get('b'))?.needsDownload).toBe(1)
})

test("a photo the server rejects with an error doesn't stop the other uploads or the downloads", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const hashThree = await serverHolds(server, 'clay three')
  const a = await withBytes('a', 'clay one', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [a, b, await withoutBytes('c', 'clay three')])
  const rejecting: PhotoTransport = {
    ...server,
    upload: async (hash, part, bytes, sum) => {
      if (hash === a.hash) throw new SyncStopped('error')
      return server.upload(hash, part, bytes, sum)
    },
  }
  expect(await transferPhotos(db, rejecting)).toBe('error')
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b'))?.needsUpload).toBeUndefined()
  expect(server.files().has(`full/${b.hash}`)).toBe(true)
  expect((await db.photos.get('c'))?.needsDownload).toBeUndefined()
  expect(await db.photoBytes.get(hashThree)).toBeDefined()
  expect(error).toHaveBeenCalled()
})

test("a download that fails with an error doesn't stop the other downloads", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await serverHolds(server, 'clay one')
  const hashTwo = await serverHolds(server, 'clay two')
  await seed(db, [
    await withoutBytes('a', 'clay one'),
    await withoutBytes('b', 'clay two'),
  ])
  const failing: PhotoTransport = {
    ...server,
    download: async (hash, part) => {
      if (hash !== hashTwo) throw new SyncStopped('error')
      return server.download(hash, part)
    },
  }
  expect(await transferPhotos(db, failing)).toBe('error')
  expect((await db.photos.get('b'))?.needsDownload).toBeUndefined()
  expect((await db.photos.get('a'))?.needsDownload).toBe(1)
  expect(error).toHaveBeenCalled()
})

test("a missing check that fails with an error doesn't stop the downloads", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await serverHolds(server, 'clay two')
  await seed(db, [
    await withBytes('a', 'clay one', { needsUpload: 1 }),
    await withoutBytes('b', 'clay two'),
  ])
  const failing: PhotoTransport = {
    ...server,
    missing: async () => {
      throw new SyncStopped('error')
    },
  }
  expect(await transferPhotos(db, failing)).toBe('error')
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b'))?.needsDownload).toBeUndefined()
  expect(error).toHaveBeenCalled()
})

test('an offline upload stops at once and the downloads never start', async () => {
  await serverHolds(server, 'clay two')
  await seed(db, [
    await withBytes('a', 'clay one', { needsUpload: 1 }),
    await withBytes('x', 'clay x', { needsUpload: 1 }),
    await withoutBytes('b', 'clay two'),
  ])
  const upload = vi.fn(async () => {
    throw new SyncStopped('offline')
  })
  const download = vi.spyOn(server, 'download')
  expect(await transferPhotos(db, { ...server, upload })).toBe('offline')
  expect(upload).toHaveBeenCalledTimes(1)
  expect(download).not.toHaveBeenCalled()
})

test('a missing check that goes offline stops at once', async () => {
  await seed(db, [await withBytes('a', 'clay one', { needsUpload: 1 })])
  const missing = async () => {
    throw new SyncStopped('offline')
  }
  expect(await transferPhotos(db, { ...server, missing })).toBe('offline')
})

test('a 0-byte image is skipped and logged, and the others upload', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const empty = await withBytes('a', '', { needsUpload: 1 })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [empty, b])
  const upload = vi.spyOn(server, 'upload')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(upload.mock.calls.every(([hash]) => hash === b.hash)).toBe(true)
  expect(server.files().has(`full/${b.hash}`)).toBe(true)
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect(error).toHaveBeenCalledTimes(1)
})

test('a 0-byte thumbnail is skipped and logged', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const a = await withBytes('a', 'clay one', {
    needsUpload: 1,
    thumb: new Blob([], { type: 'image/jpeg' }),
  })
  await seed(db, [a])
  const upload = vi.spyOn(server, 'upload')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(upload).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledTimes(1)
})

test("a hash that isn't a photo hash stays out of the missing check and keeps waiting", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bad = await withBytes('a', 'clay one', {
    needsUpload: 1,
    hash: 'not-a-hash',
  })
  const b = await withBytes('b', 'clay two', { needsUpload: 1 })
  await seed(db, [bad, b])
  const missing = vi.spyOn(server, 'missing')
  expect(await transferPhotos(db, server)).toBe('done')
  expect(missing).toHaveBeenCalledTimes(1)
  expect(missing).toHaveBeenCalledWith([b.hash])
  expect((await db.photos.get('a'))?.needsUpload).toBe(1)
  expect((await db.photos.get('b'))?.needsUpload).toBeUndefined()
  expect(error).toHaveBeenCalledTimes(1)
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
  expect((await db.photos.get('b'))?.needsDownload).toBeUndefined()
  expect((await db.photos.get('b'))?.needsUpload).toBeUndefined()
})
