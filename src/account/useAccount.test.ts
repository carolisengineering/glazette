import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./api', () => ({
  fetchSession: vi.fn(),
  signOutRemote: vi.fn(),
}))

const KEY = 'glazette.account'

async function load() {
  vi.resetModules()
  const api = await import('./api')
  const mod = await import('./useAccount')
  return { api: vi.mocked(api), ...mod }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => vi.restoreAllMocks())

describe('useAccount', () => {
  test('hydrates signed-in from the cached email', async () => {
    localStorage.setItem(KEY, 'me@example.com')
    const { useAccount } = await load()
    expect(useAccount.getState()).toMatchObject({
      status: 'signed-in',
      email: 'me@example.com',
    })
  })

  test('hydrates signed-out with no cache, and when localStorage throws', async () => {
    let m = await load()
    expect(m.useAccount.getState().status).toBe('signed-out')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    m = await load()
    expect(m.useAccount.getState().status).toBe('signed-out')
  })

  test('refresh with a live session signs in and caches the email', async () => {
    const { useAccount, api } = await load()
    api.fetchSession.mockResolvedValue({ email: 'me@example.com' })
    await useAccount.getState().refresh()
    expect(useAccount.getState()).toMatchObject({
      status: 'signed-in',
      email: 'me@example.com',
    })
    expect(localStorage.getItem(KEY)).toBe('me@example.com')
  })

  test('refresh offline keeps the cached email and stays signed in', async () => {
    localStorage.setItem(KEY, 'me@example.com')
    const { useAccount, api } = await load()
    api.fetchSession.mockResolvedValue('offline')
    await useAccount.getState().refresh()
    expect(useAccount.getState()).toMatchObject({
      status: 'signed-in',
      email: 'me@example.com',
    })
    expect(localStorage.getItem(KEY)).toBe('me@example.com')
  })

  test('refresh with a null session signs out and clears the cache', async () => {
    localStorage.setItem(KEY, 'me@example.com')
    const { useAccount, api } = await load()
    api.fetchSession.mockResolvedValue(null)
    await useAccount.getState().refresh()
    expect(useAccount.getState().status).toBe('signed-out')
    expect(useAccount.getState().email).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('signedIn sets state and caches', async () => {
    const { useAccount } = await load()
    useAccount.getState().signedIn('me@example.com')
    expect(useAccount.getState()).toMatchObject({
      status: 'signed-in',
      email: 'me@example.com',
    })
    expect(localStorage.getItem(KEY)).toBe('me@example.com')
  })

  test('signOut clears local state even when the network call fails', async () => {
    localStorage.setItem(KEY, 'me@example.com')
    const { useAccount, api } = await load()
    api.signOutRemote.mockRejectedValue(new TypeError('offline'))
    await useAccount.getState().signOut()
    expect(useAccount.getState().status).toBe('signed-out')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('a throwing localStorage does not break refresh', async () => {
    const { useAccount, api } = await load()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    api.fetchSession.mockResolvedValue({ email: 'me@example.com' })
    await expect(useAccount.getState().refresh()).resolves.toBeUndefined()
    expect(useAccount.getState().status).toBe('signed-in')
    api.fetchSession.mockResolvedValue(null)
    await expect(useAccount.getState().refresh()).resolves.toBeUndefined()
    expect(useAccount.getState().status).toBe('signed-out')
  })

  test('a refresh in flight across signedIn() does not undo the sign-in', async () => {
    const { useAccount, api } = await load()
    let resolve!: (v: null) => void
    api.fetchSession.mockReturnValue(new Promise((r) => (resolve = r)))
    const pending = useAccount.getState().refresh()
    useAccount.getState().signedIn('me@example.com')
    resolve(null)
    await pending
    expect(useAccount.getState()).toMatchObject({
      status: 'signed-in',
      email: 'me@example.com',
    })
    expect(localStorage.getItem(KEY)).toBe('me@example.com')
  })

  test('a refresh in flight across signOut() does not sign the user back in', async () => {
    localStorage.setItem(KEY, 'me@example.com')
    const { useAccount, api } = await load()
    let resolve!: (v: { email: string }) => void
    api.fetchSession.mockReturnValue(new Promise((r) => (resolve = r)))
    api.signOutRemote.mockResolvedValue(undefined)
    const pending = useAccount.getState().refresh()
    await useAccount.getState().signOut()
    resolve({ email: 'me@example.com' })
    await pending
    expect(useAccount.getState().status).toBe('signed-out')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('startAccountRefresh refreshes now and on becoming visible, once', async () => {
    const { startAccountRefresh, api } = await load()
    api.fetchSession.mockResolvedValue(null)
    startAccountRefresh()
    startAccountRefresh()
    await vi.waitFor(() => expect(api.fetchSession).toHaveBeenCalledTimes(1))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(api.fetchSession).toHaveBeenCalledTimes(2))
  })
})
