import { elapsed, track } from '../telemetry/telemetry'
import { type ProcessedImage, photoErrorMessage, processImage } from './process'

/**
 * Processes a photo the user just took or picked, and reports how long that
 * took. A failure rejects with an Error whose message is ready to show.
 */
export async function processPickedPhoto(file: File): Promise<ProcessedImage> {
  const start = performance.now()
  let processed: ProcessedImage
  try {
    processed = await processImage(file)
  } catch (err) {
    throw new Error(photoErrorMessage(err), { cause: err })
  }
  track('photo_processed', {
    ms: elapsed(start),
    megabytes: Math.round(file.size / 1e5) / 10,
  })
  return processed
}
