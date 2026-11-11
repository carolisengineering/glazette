import type { Transport } from '../sync/engine'
import type { PhotoTransport } from '../sync/photoTransport'

/** Wraps a transport to count the records that moved, without changing what it does. */
export function countingTransport(inner: Transport): {
  transport: Transport
  counts(): { pushed: number; pulled: number }
} {
  let pushed = 0
  let pulled = 0
  return {
    transport: {
      async push(records) {
        const res = await inner.push(records)
        pushed += records.length
        return res
      },
      async pull(since) {
        const res = await inner.pull(since)
        pulled += res.records.length
        return res
      },
    },
    counts: () => ({ pushed, pulled }),
  }
}

/**
 * Wraps a photo transport to count photos and bytes that moved. A photo is its
 * full part; thumbnails add bytes but aren't counted as photos.
 */
export function countingPhotoTransport(inner: PhotoTransport): {
  transport: PhotoTransport
  counts(): { uploaded: number; downloaded: number; bytes: number }
} {
  let uploaded = 0
  let downloaded = 0
  let bytes = 0
  return {
    transport: {
      missing: (hashes) => inner.missing(hashes),
      async upload(hash, part, blob, sha256) {
        const res = await inner.upload(hash, part, blob, sha256)
        if (res === 'stored') {
          bytes += blob.size
          if (part === 'full') uploaded += 1
        }
        return res
      },
      async download(hash, part) {
        const blob = await inner.download(hash, part)
        if (blob) {
          bytes += blob.size
          if (part === 'full') downloaded += 1
        }
        return blob
      },
    },
    counts: () => ({ uploaded, downloaded, bytes }),
  }
}
