import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwatchImage } from '../photos/swatchImage'
import { CropSwatch } from './CropSwatch'
import { type CropView, sourceSquare, startView } from './cropView'

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
    expect(onUse).toHaveBeenCalledWith(made, startView(4000, 3000))
  })

  it('run labels, status and hint replace the defaults', () => {
    render(
      <CropSwatch
        source={source}
        width={4000}
        height={3000}
        labels={{ cancel: 'Done', use: 'Next' }}
        status="Over Tenmoku · 2 saved"
        hint="Saved Celadon over Tenmoku."
        onUse={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use swatch' })).toBeNull()
    expect(screen.getByText('Over Tenmoku · 2 saved')).toBeVisible()
    expect(screen.getByText('Saved Celadon over Tenmoku.')).toBeVisible()
    expect(
      screen.queryByText('Drag and pinch so the square holds only glaze'),
    ).toBeNull()
  })

  it('onUse gets the view so the next tile starts there', async () => {
    const onUse = vi.fn()
    const { unmount } = render(
      <CropSwatch
        source={source}
        width={4000}
        height={3000}
        onUse={onUse}
        onCancel={vi.fn()}
      />,
    )
    const area = screen.getByRole('dialog').querySelector('.touch-none')
    if (!area) throw new Error('no crop area')
    fireEvent.wheel(area, { deltaY: -100 })
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    await waitFor(() => expect(onUse).toHaveBeenCalled())
    const view = onUse.mock.calls[0][1] as CropView
    expect(view.zoom).toBeGreaterThan(1)
    unmount()

    render(
      <CropSwatch
        source={source}
        width={4000}
        height={3000}
        initialView={view}
        onUse={onUse}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    expect(makeSwatch).toHaveBeenLastCalledWith(
      source,
      sourceSquare(view, 4000, 3000),
    )
    expect(onUse).toHaveBeenLastCalledWith(made, view)
  })

  it('a wheel scroll up zooms in', async () => {
    setup()
    const area = screen.getByRole('dialog').querySelector('.touch-none')
    if (!area) throw new Error('no crop area')
    fireEvent.wheel(area, { deltaY: -100 })
    await userEvent.click(screen.getByRole('button', { name: 'Use swatch' }))
    const start = sourceSquare(startView(4000, 3000), 4000, 3000)
    const used = makeSwatch.mock.calls[0][1] as { size: number }
    expect(used.size).toBeLessThan(start.size)
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
    await waitFor(() =>
      expect(onUse).toHaveBeenCalledWith(made, expect.anything()),
    )
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
