// For tests only: an in-memory photo store for one user, following the same
// rules as the Worker (worker/photos.ts).

import type { PhotoPart } from '../../shared/photoProtocol'
import { sha256 } from '../photos/hash'
import type { PhotoTransport } from './photoTransport'

/** Stored bytes are kept under `${part}/${hash}`. */
export function createTestPhotoServer(): PhotoTransport & {
  files(): Map<string, Blob>
} {
  const stored = new Map<string, Blob>()
  const key = (hash: string, part: PhotoPart) => `${part}/${hash}`

  return {
    async missing(hashes) {
      return [
        ...new Set(
          hashes.filter(
            (h) => !stored.has(key(h, 'full')) || !stored.has(key(h, 'thumb')),
          ),
        ),
      ]
    },

    async upload(hash, part, bytes, checksum) {
      // As in the Worker: a full image must match its hash, a thumbnail the
      // checksum sent with it.
      const expected = part === 'full' ? hash : checksum
      if ((await sha256(bytes)) !== expected) return 'refused'
      stored.set(key(hash, part), bytes)
      return 'stored'
    },

    async download(hash, part) {
      return stored.get(key(hash, part)) ?? null
    },

    files: () => stored,
  }
}
