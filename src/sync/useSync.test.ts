import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAccount } from '../account/useAccount'
import { db } from '../db/db'
import * as bytes from '../photos/bytes'
import * as engine from './engine'
import { quietly } from './track'
import * as transfer from './transfer'
import {
  CHANGE_DELAY_MS,
  requestSync,
  startSync,
  stopSync,
  useSync,
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

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  syncOnce.mockReset().mockResolvedValue('done')
  transferPhotos.mockReset().mockResolvedValue('done')
  moveBytesApart.mockReset().mockResolvedValue(undefined)
  useSync.setState({ syncing: false, failed: false })
  useAccount.setState({ refresh: realRefresh })
  setAccount(undefined)
})
afterEach(() => {
  stopSync()
  vi.useRealTimers()
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
