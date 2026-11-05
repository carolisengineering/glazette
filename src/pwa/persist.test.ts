import { db } from '../db/db'
import { ensureDefaults } from '../db/ops'
import { requestPersistence } from './persist'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureDefaults()
})

test('requestPersistence resolves false when navigator.storage is missing', async () => {
  vi.stubGlobal('navigator', {})
  await expect(requestPersistence()).resolves.toBe(false)
})

test('requestPersistence returns true without asking when already persisted', async () => {
  const persist = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('navigator', {
    storage: { persisted: vi.fn().mockResolvedValue(true), persist },
  })
  await expect(requestPersistence()).resolves.toBe(true)
  expect(persist).not.toHaveBeenCalled()
})

test('requestPersistence asks again on every start until it is granted', async () => {
  const persist = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true)
  vi.stubGlobal('navigator', {
    storage: { persisted: vi.fn().mockResolvedValue(false), persist },
  })
  await expect(requestPersistence()).resolves.toBe(false)
  await expect(requestPersistence()).resolves.toBe(true)
  expect(persist).toHaveBeenCalledTimes(2)
})

test('requestPersistence still asks when persisted() is unavailable', async () => {
  const persist = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('navigator', { storage: { persist } })
  await expect(requestPersistence()).resolves.toBe(true)
})

test('requestPersistence does not write to settings', async () => {
  const before = await db.settings.get('app')
  vi.stubGlobal('navigator', {
    storage: {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(true),
    },
  })
  await requestPersistence()
  expect(await db.settings.get('app')).toEqual(before)
})

test('requestPersistence never throws when persist rejects', async () => {
  vi.stubGlobal('navigator', {
    storage: { persist: vi.fn().mockRejectedValue(new Error('no')) },
  })
  await expect(requestPersistence()).resolves.toBe(false)
})
