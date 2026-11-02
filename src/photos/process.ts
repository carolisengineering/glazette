import exifr from 'exifr'
import { fitWithin } from './fit'
import { sha256 } from './hash'

const FULL_EDGE = 2000
const THUMB_EDGE = 400
const JPEG_QUALITY = 0.8

export class UnsupportedImageError extends Error {
  constructor(message = 'This image format is not supported') {
    super(message)
    this.name = 'UnsupportedImageError'
  }
}

export interface ProcessedImage {
  blob: Blob
  thumb: Blob
  width: number
  height: number
  hash: string
  takenAt: string
}

async function decode(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new UnsupportedImageError()
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new UnsupportedImageError()
  }
}

async function resize(
  bitmap: ImageBitmap,
  max: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: JPEG_QUALITY,
  })
  return { blob, width: w, height: h }
}

async function readTakenAt(file: File): Promise<string> {
  try {
    const exif = await exifr.parse(file, ['DateTimeOriginal'])
    const taken: unknown = exif?.DateTimeOriginal
    if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
      return taken.toISOString()
    }
  } catch {
    // Unreadable EXIF falls back to now.
  }
  return new Date().toISOString()
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const bitmap = await decode(file)
  try {
    const full = await resize(bitmap, FULL_EDGE)
    const thumb = await resize(bitmap, THUMB_EDGE)
    return {
      blob: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      hash: await sha256(full.blob),
      takenAt: await readTakenAt(file),
    }
  } finally {
    bitmap.close()
  }
}
