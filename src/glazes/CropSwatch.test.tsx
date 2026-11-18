import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwatchImage } from '../photos/swatchImage'
import { CropSwatch } from './CropSwatch'
import { sourceSquare, startView } from './cropView'

const makeSwatch = vi.fn()
vi.mock('../photos/swatchImage', () => ({
  makeSwatch: (...args: unknown[]) => makeSwatch(...args),
}))

const made = { color: '#aabbcc' } as unknown as SwatchImage
const source = new Blob(['x'], { type: 'image/jpeg' })

beforeEach(() => {
  makeSwatch.mockResolvedValue(made)
  URL.createObjectURL = vi.fn(() => 'blob:crop')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.clearAllMocks())

function setup() {
  const onUse = vi.fn()
  const onCancel = vi.fn()
  render(
    <CropSwatch
      source={source}
      width={4000}
      height={3000}
      onUse={onUse}
      onCancel={onCancel}
    />,
  )
  return { onUse, onCancel }
}

describe('CropSwatch', () => {
  it('Use swatch passes the made image to onUse', async () => {
    const { onUse } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    expect(makeSwatch).toHaveBeenCalledWith(
      source,
      sourceSquare(startView(4000, 3000), 4000, 3000),
    )
    expect(onUse).toHaveBeenCalledWith(made)
  })

  it('Cancel calls onCancel and makes nothing', async () => {
    const { onCancel, onUse } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(makeSwatch).not.toHaveBeenCalled()
    expect(onUse).not.toHaveBeenCalled()
  })

  it('Escape cancels', async () => {
    const { onCancel } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('Escape does nothing while the swatch is being made', async () => {
    let finish: (image: SwatchImage) => void = () => {}
    makeSwatch.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { onCancel, onUse } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    await userEvent.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    finish(made)
    await waitFor(() => expect(onUse).toHaveBeenCalledWith(made))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stays open with an error when making the swatch fails', async () => {
    makeSwatch.mockRejectedValue(new Error('nope'))
    const { onUse } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument()
    expect(onUse).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: 'Crop swatch' }),
    ).toBeInTheDocument()
  })
})
