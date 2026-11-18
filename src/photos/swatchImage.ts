import { sha256 } from './hash'
import { type ProcessedImage, UnsupportedImageError } from './process'

export const SWATCH_EDGE = 600
export const SWATCH_THUMB_EDGE = 400
const JPEG_QUALITY = 0.8

/** A cropped swatch photo, with the average color of the crop as a hex string. */
export interface SwatchImage extends ProcessedImage {
  color: string
}

/** The square to cut from the source photo, in source pixels. */
export interface SourceSquare {
  sx: number
  sy: number
  size: number
}

/** The average of RGBA pixel bytes as lowercase `#rrggbb`. Alpha is ignored. */
export function averageColor(pixels: Uint8ClampedArray): string {
  const count = pixels.length / 4
  const sums = [0, 0, 0]
  for (let i = 0; i < pixels.length; i += 4) {
    sums[0] += pixels[i]
    sums[1] += pixels[i + 1]
    sums[2] += pixels[i + 2]
  }
  const hex = sums.map((sum) =>
    Math.round(sum / count)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${hex.join('')}`
}

function drawSquare(
  bitmap: ImageBitmap,
  square: SourceSquare,
  edge: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(edge, edge)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    bitmap,
    square.sx,
    square.sy,
    square.size,
    square.size,
    0,
    0,
    edge,
    edge,
  )
  return { canvas, ctx }
}

/** Cuts a square from the photo into a swatch image, thumbnail and average color. */
export async function makeSwatch(
  source: Blob,
  square: SourceSquare,
): Promise<SwatchImage> {
  if (typeof createImageBitmap !== 'function') throw new UnsupportedImageError()
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch (err) {
    throw new UnsupportedImageError(undefined, { cause: err })
  }
  try {
    const full = drawSquare(bitmap, square, SWATCH_EDGE)
    const color = averageColor(
      full.ctx.getImageData(0, 0, SWATCH_EDGE, SWATCH_EDGE).data,
    )
    const blob = await full.canvas.convertToBlob({
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
    })
    const small = drawSquare(bitmap, square, SWATCH_THUMB_EDGE)
    const thumb = await small.canvas.convertToBlob({
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
    })
    return {
      blob,
      thumb,
      width: SWATCH_EDGE,
      height: SWATCH_EDGE,
      hash: await sha256(blob),
      takenAt: new Date().toISOString(),
      color,
    }
  } finally {
    bitmap.close()
  }
}
