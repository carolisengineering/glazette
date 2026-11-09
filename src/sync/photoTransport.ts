import { type PhotoPart, photoFileUrl } from '../../shared/photoProtocol'
import { isObject } from '../db/rowChecks'
import { SyncStopped } from './engine'
import { timedFetch } from './transport'

/**
 * How long one photo request may take before the sync gives up on it as
 * offline. Longer than a record's, so a full image fits on a slow connection.
 */
export const PHOTO_TIMEOUT_MS = 120_000

/** How the device moves photo bytes. Every method throws SyncStopped. */
export interface PhotoTransport {
  /** The hashes the server doesn't hold both parts of. */
  missing(hashes: string[]): Promise<string[]>
  /** 'refused' when the server won't take these bytes. */
  upload(
    hash: string,
    part: PhotoPart,
    bytes: Blob,
    sha256: string,
  ): Promise<'stored' | 'refused'>
  /** The bytes, or null when the server doesn't have them yet. */
  download(hash: string, part: PhotoPart): Promise<Blob | null>
}

/** Throws for 401 and for any other non-2xx status. */
function rejectUnlessOk(res: Response): void {
  if (res.status === 401) throw new SyncStopped('signed-out')
  if (!res.ok) throw new SyncStopped('error')
}

/** Same-origin calls to the Worker's photo routes. */
export const fetchPhotoTransport: PhotoTransport = {
  missing(hashes) {
    return timedFetch(
      '/api/photos/missing',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hashes }),
      },
      PHOTO_TIMEOUT_MS,
      async (res) => {
        rejectUnlessOk(res)
        const body: unknown = await res.json()
        if (
          !isObject(body) ||
          !Array.isArray(body.missing) ||
          !body.missing.every((h) => typeof h === 'string')
        ) {
          throw new SyncStopped('error')
        }
        return body.missing as string[]
      },
    )
  },

  upload(hash, part, bytes, sha256) {
    return timedFetch(
      photoFileUrl(hash, part),
      {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-content-sha256': sha256 },
        body: bytes,
      },
      PHOTO_TIMEOUT_MS,
      async (res): Promise<'stored' | 'refused'> => {
        if (res.status === 413) return 'refused'
        if (res.status === 400) {
          const body: unknown = await res.json().catch(() => undefined)
          if (isObject(body) && body.code === 'PHOTO_MISMATCH') return 'refused'
          throw new SyncStopped('error')
        }
        rejectUnlessOk(res)
        const body: unknown = await res.json()
        if (!isObject(body) || body.stored !== true) {
          throw new SyncStopped('error')
        }
        return 'stored'
      },
    )
  },

  download(hash, part) {
    return timedFetch(
      photoFileUrl(hash, part),
      { method: 'GET' },
      PHOTO_TIMEOUT_MS,
      async (res) => {
        if (res.status === 404) return null
        rejectUnlessOk(res)
        // A connection lost mid-body is being offline, not a server fault.
        try {
          return await res.blob()
        } catch {
          throw new SyncStopped('offline')
        }
      },
    )
  },
}
