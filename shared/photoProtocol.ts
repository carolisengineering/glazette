// The shared contract between the app and the Worker for syncing photos.
// Pure TypeScript: no DOM or Workers types.

export const PHOTO_PARTS = ['full', 'thumb'] as const

export type PhotoPart = (typeof PHOTO_PARTS)[number]

// A photo's id: the lowercase hex SHA-256 of its full image.
export const PHOTO_HASH = /^[0-9a-f]{64}$/

export const MAX_FULL_BYTES = 8_000_000
export const MAX_THUMB_BYTES = 1_000_000
// Hashes per missing check.
export const MISSING_LIMIT = 200

export interface MissingBody {
  hashes: string[]
}

export interface MissingResponse {
  // Hashes that don't have both parts stored, in request order.
  missing: string[]
}

export function photoFileUrl(hash: string, part: PhotoPart): string {
  return `/api/photos/${hash}/${part}`
}
