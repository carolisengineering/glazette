import { describe, expect, it } from 'vitest'
import { averageColor } from './swatchImage'

describe('averageColor', () => {
  it('of one red pixel is #ff0000', () => {
    expect(averageColor(new Uint8ClampedArray([255, 0, 0, 255]))).toBe(
      '#ff0000',
    )
  })

  it('of black and white pixels is #808080', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    expect(averageColor(pixels)).toBe('#808080')
  })

  it('ignores alpha', () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 255])
    expect(averageColor(pixels)).toBe('#0a141e')
  })
})
