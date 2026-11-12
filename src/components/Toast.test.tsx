import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from './useToast'

function Harness({ onPress }: { onPress?: () => void }) {
  const { show, toast } = useToast()
  return (
    <div>
      <button type="button" onClick={() => show('Plain message')}>
        plain
      </button>
      <button
        type="button"
        onClick={() =>
          show('Photo changed', {
            action: { label: 'Undo', onPress: onPress ?? (() => {}) },
            duration: 6000,
          })
        }
      >
        with action
      </button>
      {toast}
    </div>
  )
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('an action button runs and dismisses', () => {
    const onPress = vi.fn()
    render(<Harness onPress={onPress} />)
    fireEvent.click(screen.getByText('with action'))
    expect(screen.getByRole('status').textContent).toContain('Photo changed')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a toast with an action still dismisses itself after its duration', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('with action'))
    act(() => {
      vi.advanceTimersByTime(5900)
    })
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a plain toast has no button', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('plain'))
    expect(screen.getByRole('status').textContent).toBe('Plain message')
    expect(screen.getByRole('status').querySelector('button')).toBeNull()
  })
})
