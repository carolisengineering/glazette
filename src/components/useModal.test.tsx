import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { useModal } from './useModal'

function Modal({
  onClose,
  children,
}: {
  onClose: () => void
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useModal(ref, onClose)
  return (
    <div>
      <button type="button" ref={ref}>
        x
      </button>
      {children}
    </div>
  )
}

test('Escape closes only the topmost modal, then the one below', async () => {
  const outer = vi.fn()
  const inner = vi.fn()
  const { rerender } = render(<Modal onClose={outer} />)
  rerender(
    <Modal onClose={outer}>
      <Modal onClose={inner} />
    </Modal>,
  )
  await userEvent.keyboard('{Escape}')
  expect(inner).toHaveBeenCalledTimes(1)
  expect(outer).not.toHaveBeenCalled()
  rerender(<Modal onClose={outer} />)
  await userEvent.keyboard('{Escape}')
  expect(outer).toHaveBeenCalledTimes(1)
  expect(inner).toHaveBeenCalledTimes(1)
})
