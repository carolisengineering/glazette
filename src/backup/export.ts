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

export type ReadBytes = (blob: Blob) => Promise<Uint8Array>

// Strict on purpose: a photo that isn't a real Blob must fail the export, not
// land in the backup as an empty file.
export const readBlobBytes: ReadBytes = async (blob) => {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new Error('Cannot export a photo that is not a Blob')
  }
  return new Uint8Array(await blob.arrayBuffer())
}

export function backupFileName(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `glazette-${y}-${m}-${d}.zip`
}

export async function exportZip(
  now: Date = new Date(),
  readBytes: ReadBytes = readBlobBytes,
): Promise<Blob> {
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
  for (const {
    blob,
    thumb,
    dirty: _dirty,
    needsUpload: _needsUpload,
    needsDownload: _needsDownload,
    ...meta
  } of photos) {
    photoMeta.push(meta)
    // A photo whose bytes haven't downloaded yet has details only.
    if (!blob) continue
    // JPEGs are already compressed, so store them.
    files[photoPath(meta.hash)] = [await readBytes(blob), { level: 0 }]
    if (thumb) {
      files[thumbPath(meta.hash)] = [await readBytes(thumb), { level: 0 }]
    }
  }

  const json: BackupJson = {
    version: BACKUP_VERSION,
    dbVersion: db.verno,
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
