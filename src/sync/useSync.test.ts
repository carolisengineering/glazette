import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAccount } from '../account/useAccount'
import { db } from '../db/db'
import * as bytes from '../photos/bytes'
import { setSinkForTests } from '../telemetry/telemetry'
import * as engine from './engine'
import { quietly } from './track'
import * as transfer from './transfer'
import {
  CHANGE_DELAY_MS,
  requestSync,
  startSync,
  stopSync,
  syncRecords,
  useSync,
  WAIT_RETRY_MAX_MS,
  WAIT_RETRY_START_MS,
} from './useSync'

vi.mock('./engine', async (orig) => ({
  ...(await orig<typeof import('./engine')>()),
  syncOnce: vi.fn(),
}))

vi.mock('./transfer', () => ({ transferPhotos: vi.fn() }))

vi.mock('../photos/bytes', async (orig) => ({
  ...(await orig<typeof import('../photos/bytes')>()),
  moveBytesApart: vi.fn(),
}))

const syncOnce = vi.mocked(engine.syncOnce)
const transferPhotos = vi.mocked(transfer.transferPhotos)
const moveBytesApart = vi.mocked(bytes.moveBytesApart)

function setAccount(email?: string) {
  useAccount.setState(
    email
      ? { status: 'signed-in', email }
      : { status: 'signed-out', email: undefined },
  )
}

const realRefresh = useAccount.getState().refresh

// Also lets the database's real, unfaked async work finish: a run ends with a
// read of the photo rows.
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  syncOnce.mockReset().mockResolvedValue('done')
  transferPhotos.mockReset().mockResolvedValue('done')
  moveBytesApart.mockReset().mockResolvedValue(undefined)
  useSync.setState({ syncing: false, failed: false })
  useAccount.setState({ refresh: realRefresh })
  setAccount(undefined)
})
afterEach(async () => {
  setSinkForTests(undefined)
  stopSync()
  setAccount(undefined)
  requestSync() // clears a wait check left by a test that never started sync
  vi.useRealTimers()
  await quietly(db, () => db.photos.clear())
})

const MIN = 60_000

const waitingPhoto = (id: string, extra = {}) => ({
  id,
  hash: id,
  width: 1,
  height: 1,
  takenAt: '2026-11-09T00:00:00.000Z',
  needsDownload: 1 as const,
  ...extra,
})

test('a photo waiting on the other device is checked again, with growing delays', async () => {
  await quietly(db, () => db.photos.put(waitingPhoto('a')))
  setAccount('carol@example.com')
  requestSync()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  expect(WAIT_RETRY_START_MS).toBe(MIN)
  let calls = 1
  for (const delay of [1, 2, 4, 8, 16, 30, 30, 30]) {
    await vi.advanceTimersByTimeAsync(delay * MIN - 1)
    expect(syncOnce).toHaveBeenCalledTimes(calls)
    await vi.advanceTimersByTimeAsync(1)
    await flush() // the run ends and sets the next timer
    calls += 1
    expect(syncOnce).toHaveBeenCalledTimes(calls)
  }
  expect(WAIT_RETRY_MAX_MS).toBe(30 * MIN)
})

test('the wait check stops, and starts over, when nothing waits', async () => {
  await quietly(db, () => db.photos.put(waitingPhoto('a')))
  setAccount('carol@example.com')
  requestSync()
  await flush()
  await vi.advanceTimersByTimeAsync(MIN) // second run, next delay 2 minutes
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(2)
  await quietly(db, () => db.photos.update('a', { needsDownload: undefined }))
  requestSync() // another reason; it finds nothing waiting
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(60 * MIN)
  expect(syncOnce).toHaveBeenCalledTimes(3)
  // A later wait starts at one minute again.
  await quietly(db, () => db.photos.update('a', { needsDownload: 1 }))
  requestSync()
  await flush()
  await vi.advanceTimersByTimeAsync(MIN)
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(5)
})

test('a sync for another reason keeps the backoff while a photo still waits', async () => {
  await quietly(db, () => db.photos.put(waitingPhoto('a')))
  setAccount('carol@example.com')
  requestSync()
  await flush()
  await vi.advanceTimersByTimeAsync(MIN) // next delay is 2 minutes
  await flush()
  requestSync()
  await flush() // delay now 4 minutes, one timer only
  expect(syncOnce).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(4 * MIN - 1)
  expect(syncOnce).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(1)
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(4)
})

test('signing out clears the wait check', async () => {
  await quietly(db, () => db.photos.put(waitingPhoto('a')))
  setAccount('carol@example.com')
  startSync()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  setAccount(undefined)
  await vi.advanceTimersByTimeAsync(60 * MIN)
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test('stopping sync clears the wait check', async () => {
  await quietly(db, () => db.photos.put(waitingPhoto('a')))
  setAccount('carol@example.com')
  startSync()
  await flush()
  stopSync()
  await vi.advanceTimersByTimeAsync(60 * MIN)
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test('no wait check when only a deleted photo waits', async () => {
  await quietly(db, () =>
    db.photos.put(waitingPhoto('a', { deletedAt: '2026-11-09T00:00:00.000Z' })),
  )
  setAccount('carol@example.com')
  requestSync()
  await flush()
  await vi.advanceTimersByTimeAsync(60 * MIN)
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test('signed out, nothing syncs', async () => {
  startSync()
  requestSync()
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('online'))
  await db.glazes.put({ id: 'g-out', name: 'Shino' } as never)
  await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS * 2)
  expect(syncOnce).not.toHaveBeenCalled()
  expect(moveBytesApart).not.toHaveBeenCalled()
})

test('signing in syncs once', async () => {
  startSync()
  startSync() // safe to call twice
  setAccount('carol@example.com')
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  expect(syncOnce).toHaveBeenCalledWith(
    db,
    expect.anything(),
    'carol@example.com',
  )
})

test('already signed in at start-up syncs once', async () => {
  setAccount('carol@example.com')
  startSync()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test('returning to the app and coming back online sync', async () => {
  setAccount('carol@example.com')
  startSync()
  await flush()
  syncOnce.mockClear()
  document.dispatchEvent(new Event('visibilitychange'))
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('online'))
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(2)
})

test('requests during a run make exactly one more run', async () => {
  setAccount('carol@example.com')
  let finish: (o: 'done') => void = () => {}
  syncOnce.mockImplementationOnce(() => new Promise((r) => (finish = r)))
  requestSync()
  await flush()
  expect(useSync.getState().syncing).toBe(true)
  requestSync()
  requestSync()
  requestSync()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  finish('done')
  await flush()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(2)
  expect(useSync.getState().syncing).toBe(false)
})

test('a local change syncs after the delay', async () => {
  setAccount('carol@example.com')
  startSync()
  await flush()
  syncOnce.mockClear()
  await db.glazes.put({ id: 'g1', name: 'Shino' } as never)
  await vi.advanceTimersByTimeAsync(1_000)
  await db.glazes.put({ id: 'g2', name: 'Celadon' } as never)
  await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS - 1)
  expect(syncOnce).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test('an error shows and clears', async () => {
  setAccount('carol@example.com')
  syncOnce.mockResolvedValueOnce('error')
  requestSync()
  await flush()
  expect(useSync.getState().failed).toBe(true)
  requestSync()
  await flush()
  expect(useSync.getState().failed).toBe(false)
})

test('offline is not a failure', async () => {
  setAccount('carol@example.com')
  syncOnce.mockResolvedValueOnce('error')
  requestSync()
  await flush()
  syncOnce.mockResolvedValueOnce('offline')
  requestSync()
  await flush()
  expect(useSync.getState().failed).toBe(false)
})

test('a dead session signs the device out', async () => {
  setAccount('carol@example.com')
  const refresh = vi.fn().mockResolvedValue(undefined)
  useAccount.setState({ refresh })
  syncOnce.mockResolvedValueOnce('signed-out')
  requestSync()
  await flush()
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('photos transfer after a successful sync', async () => {
  setAccount('carol@example.com')
  requestSync()
  await flush()
  expect(transferPhotos).toHaveBeenCalledTimes(1)
  expect(transferPhotos).toHaveBeenCalledWith(db, expect.anything())
})

test('no transfer when the sync stops', async () => {
  setAccount('carol@example.com')
  syncOnce.mockResolvedValueOnce('offline')
  requestSync()
  await flush()
  expect(transferPhotos).not.toHaveBeenCalled()
})

test('a transfer error shows like a sync error', async () => {
  setAccount('carol@example.com')
  transferPhotos.mockResolvedValueOnce('error')
  requestSync()
  await flush()
  expect(useSync.getState().failed).toBe(true)
})

test('a transfer that finds the session dead signs the device out', async () => {
  setAccount('carol@example.com')
  const refresh = vi.fn().mockResolvedValue(undefined)
  useAccount.setState({ refresh })
  transferPhotos.mockResolvedValueOnce('signed-out')
  requestSync()
  await flush()
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('syncing stays on through the transfer, and a request leads to one more run', async () => {
  setAccount('carol@example.com')
  let finish: (o: 'done') => void = () => {}
  transferPhotos.mockImplementationOnce(() => new Promise((r) => (finish = r)))
  requestSync()
  await flush()
  expect(useSync.getState().syncing).toBe(true)
  requestSync()
  requestSync()
  finish('done')
  await flush()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(2)
  expect(useSync.getState().syncing).toBe(false)
})

test('existing photos move before the first sync', async () => {
  const real =
    await vi.importActual<typeof import('../photos/bytes')>('../photos/bytes')
  moveBytesApart.mockImplementationOnce(real.moveBytesApart)
  const hash = 'a'.repeat(64)
  await quietly(db, () =>
    db.photos.add({
      id: 'old',
      hash,
      blob: new Blob(['full']),
      thumb: new Blob(['thumb']),
      width: 1,
      height: 1,
      takenAt: '2026-01-01T00:00:00.000Z',
    }),
  )
  let atSync: { onRow: boolean; inTable: boolean } | undefined
  syncOnce.mockImplementationOnce(async () => {
    atSync = {
      onRow: !!(await db.photos.get('old'))?.blob,
      inTable: !!(await db.photoBytes.get(hash)),
    }
    return 'done'
  })
  setAccount('carol@example.com')
  requestSync()
  await vi.waitFor(() => expect(atSync).toBeDefined())
  expect(atSync).toEqual({ onRow: false, inTable: true })
  await quietly(db, async () => {
    await db.photos.clear()
    await db.photoBytes.clear()
  })
})

test('the sync waits for the move, and every run tries it', async () => {
  setAccount('carol@example.com')
  let finish: () => void = () => {}
  moveBytesApart.mockImplementationOnce(
    () => new Promise<void>((r) => (finish = r)),
  )
  requestSync()
  await flush()
  expect(moveBytesApart).toHaveBeenCalledWith(db)
  expect(syncOnce).not.toHaveBeenCalled()
  expect(useSync.getState().syncing).toBe(true)
  finish()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)

  requestSync()
  await flush()
  expect(moveBytesApart).toHaveBeenCalledTimes(2)
})

test('signing out during the move stops the run before it syncs', async () => {
  setAccount('carol@example.com')
  let finish: () => void = () => {}
  moveBytesApart.mockImplementationOnce(
    () => new Promise<void>((r) => (finish = r)),
  )
  requestSync()
  await flush()
  setAccount(undefined)
  finish()
  await flush()
  expect(syncOnce).not.toHaveBeenCalled()
  expect(useSync.getState().syncing).toBe(false)
})

// --- A record sync a caller waits on -----------------------------------------

type Outcome = engine.SyncOutcome

test('signed out, a record sync does nothing', async () => {
  expect(await syncRecords()).toBe('signed-out')
  expect(syncOnce).not.toHaveBeenCalled()
})

test('a record sync runs one and ends with it, without the photo transfer', async () => {
  setAccount('carol@example.com')
  syncOnce.mockResolvedValueOnce('offline')
  expect(await syncRecords()).toBe('offline')
  expect(syncOnce).toHaveBeenCalledTimes(1)
  expect(syncOnce).toHaveBeenCalledWith(
    db,
    expect.anything(),
    'carol@example.com',
  )
  expect(transferPhotos).not.toHaveBeenCalled()
})

test("a record sync asked for during a run's record part waits for that one", async () => {
  setAccount('carol@example.com')
  let finish: (o: Outcome) => void = () => {}
  syncOnce.mockImplementationOnce(() => new Promise((r) => (finish = r)))
  requestSync()
  await flush()
  let outcome: Outcome | undefined
  void syncRecords().then((o) => (outcome = o))
  await flush()
  expect(outcome).toBeUndefined()
  finish('error')
  await flush()
  expect(outcome).toBe('error')
  expect(syncOnce).toHaveBeenCalledTimes(1)
})

test("a record sync asked for while a run's photos transfer doesn't wait for them", async () => {
  setAccount('carol@example.com')
  let finish: (o: Outcome) => void = () => {}
  transferPhotos.mockImplementationOnce(() => new Promise((r) => (finish = r)))
  requestSync()
  await flush()
  expect(transferPhotos).toHaveBeenCalledTimes(1)
  let outcome: Outcome | undefined
  void syncRecords().then((o) => (outcome = o))
  await flush()
  expect(outcome).toBe('done')
  expect(syncOnce).toHaveBeenCalledTimes(2)
  expect(useSync.getState().syncing).toBe(true)
  finish('done')
  await flush()
})

test("a run's record part waits for a record sync already running", async () => {
  setAccount('carol@example.com')
  let finish: (o: Outcome) => void = () => {}
  syncOnce.mockImplementationOnce(() => new Promise((r) => (finish = r)))
  const asked = syncRecords()
  await flush()
  requestSync()
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(1)
  finish('done')
  expect(await asked).toBe('done')
  await flush()
  expect(syncOnce).toHaveBeenCalledTimes(2)
  expect(transferPhotos).toHaveBeenCalledTimes(1)
})

function captureEvents() {
  const events: Array<[string, Record<string, unknown>]> = []
  setSinkForTests({
    capture: (n, p) => events.push([n, p]),
    identify: () => {},
    reset: () => {},
    captureException: () => {},
  })
  return events
}

test('reports one sync_records per record sync with its outcome', async () => {
  const events = captureEvents()
  syncOnce.mockResolvedValue('offline')
  setAccount('carol@example.com')
  await syncRecords()
  const reported = events.filter(([n]) => n === 'sync_records')
  expect(reported).toHaveLength(1)
  expect(reported[0][1]).toMatchObject({
    outcome: 'offline',
    pushed: 0,
    pulled: 0,
  })
  expect(reported[0][1].ms).toEqual(expect.any(Number))
})

test('a record sync that never ran because of sign-out reports nothing', async () => {
  const events = captureEvents()
  await syncRecords()
  expect(events).toEqual([])
})

test('an idle photo transfer reports nothing', async () => {
  const events = captureEvents()
  setAccount('carol@example.com')
  requestSync()
  await flush()
  expect(transferPhotos).toHaveBeenCalledTimes(1)
  expect(events.filter(([n]) => n === 'sync_photos')).toEqual([])
})

test('a photo transfer that stopped early reports its outcome', async () => {
  const events = captureEvents()
  transferPhotos.mockResolvedValue('offline')
  setAccount('carol@example.com')
  requestSync()
  await flush()
  const photos = events.filter(([n]) => n === 'sync_photos')
  expect(photos).toHaveLength(1)
  expect(photos[0][1]).toMatchObject({
    outcome: 'offline',
    uploaded: 0,
    downloaded: 0,
    bytes: 0,
  })
})
