import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, pan, sourceSquare, startView, zoomTo } from './cropView'

describe('cropView', () => {
  it('startView centers at zoom 1', () => {
    expect(startView(4000, 3000)).toEqual({ zoom: 1, cx: 2000, cy: 1500 })
    expect(sourceSquare(startView(4000, 3000), 4000, 3000)).toEqual({
      sx: 500,
      sy: 0,
      size: 3000,
    })
  })

  it('pan moves the square opposite to the finger', () => {
    const v = startView(4000, 3000)
    expect(pan(v, 30, 0, 300, 4000, 3000).cx).toBe(1700)
  })

  it("pan stops at the photo's edge", () => {
    const v = startView(4000, 3000)
    const right = pan(v, 100000, 0, 300, 4000, 3000)
    expect(sourceSquare(right, 4000, 3000).sx).toBe(0)
    const zoomed = zoomTo(v, 2, 4000, 3000)
    const down = pan(zoomed, 0, -100000, 300, 4000, 3000)
    const sq = sourceSquare(down, 4000, 3000)
    expect(sq.sy + sq.size).toBe(3000)
  })

  it('zoomTo clamps between 1 and MAX_ZOOM', () => {
    const v = startView(4000, 3000)
    expect(zoomTo(v, 0.5, 4000, 3000).zoom).toBe(1)
    expect(zoomTo(v, 20, 4000, 3000).zoom).toBe(MAX_ZOOM)
  })

  it('zoomTo out near an edge pulls the center back inside', () => {
    const zoomed = zoomTo(startView(4000, 3000), 4, 4000, 3000)
    const corner = pan(zoomed, 100000, 100000, 300, 4000, 3000)
    const out = zoomTo(corner, 1, 4000, 3000)
    const sq = sourceSquare(out, 4000, 3000)
    expect(sq.sx).toBeGreaterThanOrEqual(0)
    expect(sq.sx + sq.size).toBeLessThanOrEqual(4000)
    expect(sq.sy).toBe(0)
  })
})
