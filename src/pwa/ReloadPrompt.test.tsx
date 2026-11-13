import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReloadPrompt } from './ReloadPrompt'

const state = vi.hoisted(() => ({
  needRefresh: false,
  update: vi.fn(),
  registration: { update: vi.fn() },
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: {
    onRegisteredSW?: (url: string, r: unknown) => void
  }) => {
    opts?.onRegisteredSW?.('/sw.js', state.registration)
    return {
      needRefresh: [state.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: state.update,
    }
  },
}))

test('ReloadPrompt shows Reload only when a new version is waiting', async () => {
  state.needRefresh = false
  const { rerender } = render(<ReloadPrompt />)
  expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

  state.needRefresh = true
  rerender(<ReloadPrompt />)
  expect(screen.getByText('New version available')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
  expect(state.update).toHaveBeenCalledWith(true)
})

test('Reload leaves an update note before reloading', async () => {
  sessionStorage.removeItem('glazette:update-reload')
  state.needRefresh = true
  state.update.mockReset()
  let noteWasThere = false
  state.update.mockImplementation(() => {
    noteWasThere = sessionStorage.getItem('glazette:update-reload') !== null
  })
  render(<ReloadPrompt />)
  await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
  expect(noteWasThere).toBe(true)
  expect(sessionStorage.getItem('glazette:update-reload')).not.toBeNull()
  expect(state.update).toHaveBeenCalledWith(true)
  sessionStorage.removeItem('glazette:update-reload')
  state.needRefresh = false
})

test('ReloadPrompt checks for a new version when the app becomes visible', () => {
  state.registration.update.mockClear()
  render(<ReloadPrompt />)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(state.registration.update).toHaveBeenCalled()
})

test('ReloadPrompt adds one visibility listener across renders and removes it on unmount', () => {
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  state.registration.update.mockClear()
  const { rerender, unmount } = render(<ReloadPrompt />)
  rerender(<ReloadPrompt />)
  rerender(<ReloadPrompt />)
  const added = add.mock.calls.filter(([t]) => t === 'visibilitychange')
  expect(added).toHaveLength(1)
  unmount()
  expect(
    remove.mock.calls.filter(([t]) => t === 'visibilitychange'),
  ).toHaveLength(1)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(state.registration.update).not.toHaveBeenCalled()
  add.mockRestore()
  remove.mockRestore()
})

test('ReloadPrompt catches a failed update check (offline)', () => {
  const caught = vi.fn()
  state.registration.update.mockReset().mockReturnValue({ catch: caught })
  render(<ReloadPrompt />)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(state.registration.update).toHaveBeenCalledTimes(1)
  expect(caught).toHaveBeenCalledWith(expect.any(Function))
  state.registration.update.mockReset()
})

test('Reload still reloads when sessionStorage is blocked', async () => {
  state.needRefresh = true
  state.update.mockReset()
  const spy = vi
    .spyOn(window, 'sessionStorage', 'get')
    .mockImplementation(() => {
      throw new Error('blocked')
    })
  try {
    render(<ReloadPrompt />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(state.update).toHaveBeenCalledWith(true)
  } finally {
    spy.mockRestore()
    state.needRefresh = false
  }
})

describe('the update note when no reload follows', () => {
  const KEY = 'glazette:update-reload'
  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.removeItem(KEY)
    state.needRefresh = false
  })

  it('is removed after 10 seconds if the page did not reload', () => {
    vi.useFakeTimers()
    sessionStorage.removeItem(KEY)
    state.needRefresh = true
    state.update.mockReset().mockReturnValue(new Promise(() => {}))
    render(<ReloadPrompt />)
    act(() => screen.getByRole('button', { name: 'Reload' }).click())
    expect(sessionStorage.getItem(KEY)).not.toBeNull()
    vi.advanceTimersByTime(9_999)
    expect(sessionStorage.getItem(KEY)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('is removed at once if the update call rejects', async () => {
    sessionStorage.removeItem(KEY)
    state.needRefresh = true
    state.update.mockReset().mockRejectedValue(new Error('nope'))
    render(<ReloadPrompt />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull())
  })
})
