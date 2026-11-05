import { type Zippable, zipSync } from 'fflate'
import { db } from '../db/db'
import {
  BACKUP_JSON_PATH,
  BACKUP_VERSION,
  type BackupJson,
  type PhotoMeta,
  photoPath,
  thumbPath,
} from './format'

// Real browsers hand back real Blobs. In tests, fake-indexeddb returns stored
// Blobs as empty plain objects (bytes lost), and jsdom's Blob lacks
// arrayBuffer(), so fall back to FileReader, and to no bytes for plain objects.
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer())
  }
  if (!(blob instanceof Blob)) return new Uint8Array(0)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export function backupFileName(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `glazette-${y}-${m}-${d}.zip`
}

export async function exportZip(now: Date = new Date()): Promise<Blob> {
  const [pieces, entries, glazeApps, glazes, clays, settings, photos] =
    await db.transaction(
      'r',
      [
        db.pieces,
        db.entries,
        db.glazeApps,
        db.glazes,
        db.clays,
        db.settings,
        db.photos,
      ],
      () =>
        Promise.all([
          db.pieces.toArray(),
          db.entries.toArray(),
          db.glazeApps.toArray(),
          db.glazes.toArray(),
          db.clays.toArray(),
          db.settings.get('app'),
          db.photos.toArray(),
        ]),
    )

  const files: Zippable = {}
  const photoMeta: PhotoMeta[] = []
  for (const { blob, thumb, ...meta } of photos) {
    photoMeta.push(meta)
    // JPEGs are already compressed, so store them.
    files[photoPath(meta.hash)] = [await blobBytes(blob), { level: 0 }]
    files[thumbPath(meta.hash)] = [await blobBytes(thumb), { level: 0 }]
  }

  const json: BackupJson = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    pieces,
    entries,
    glazeApps,
    glazes,
    clays,
    settings: settings ?? null,
    photos: photoMeta,
  }
  files[BACKUP_JSON_PATH] = new TextEncoder().encode(JSON.stringify(json))

  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' })
}
