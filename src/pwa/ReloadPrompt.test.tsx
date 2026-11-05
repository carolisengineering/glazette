import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReloadPrompt } from './ReloadPrompt'

const state = vi.hoisted(() => ({
  needRefresh: false,
  update: vi.fn(),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: state.update,
  }),
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
