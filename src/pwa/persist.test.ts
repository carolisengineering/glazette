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

test('requestPersistence asks only once across two calls', async () => {
  const persist = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('navigator', { storage: { persist } })
  await expect(requestPersistence()).resolves.toBe(true)
  await requestPersistence()
  expect(persist).toHaveBeenCalledTimes(1)
  expect((await db.settings.get('app'))?.persistRequested).toBe(true)
})

test('requestPersistence never throws when persist rejects', async () => {
  vi.stubGlobal('navigator', {
    storage: { persist: vi.fn().mockRejectedValue(new Error('no')) },
  })
  await expect(requestPersistence()).resolves.toBe(false)
})
