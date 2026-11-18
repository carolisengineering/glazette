import type { ProcessedImage } from './process'

/** A cropped swatch photo, with the average color of the crop as a hex string. */
export interface SwatchImage extends ProcessedImage {
  color: string
}
