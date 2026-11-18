import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { GlazeSwatch } from './GlazeSwatch'

const row = (id: string, hash: string, over = {}) => ({
  id,
  hash,
  width: 600,
  height: 600,
  takenAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

test("GlazeSwatch shows the color while its photo isn't on this device", async () => {
  await db.photos.add(row('p1', 'h1', { needsDownload: 1 }))
  render(<GlazeSwatch color="#8FB3A3" photoId="p1" className="size-16" />)
  const box = screen.getByTestId('glaze-swatch')
  expect(box).toHaveStyle({ backgroundColor: '#8FB3A3' })
  await waitFor(() => expect(db.photos.get('p1')).resolves.toBeDefined())
  expect(box.querySelector('img')).toBeNull()
  // Nothing opaque sits over the color.
  const cover = box.firstElementChild as HTMLElement
  expect(cover.style.backgroundColor).toBe('transparent')
})

test('GlazeSwatch is just the color without a photo', () => {
  render(<GlazeSwatch color="#8FB3A3" className="size-16" />)
  const box = screen.getByTestId('glaze-swatch')
  expect(box).toHaveStyle({ backgroundColor: '#8FB3A3' })
  expect(box.children).toHaveLength(0)
})
