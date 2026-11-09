import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAccount } from '../account/useAccount'
import { db } from '../db/db'
import * as engine from './engine'
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

const syncOnce = vi.mocked(engine.syncOnce)
const transferPhotos = vi.mocked(transfer.transferPhotos)

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
