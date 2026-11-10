import { type DeletedItem, RETENTION_DAYS } from '../../shared/syncProtocol'
import type { Photo, Piece } from '../db/types'

const DAY_MS = 86_400_000

/**
 * How long a deleted item has left, in whole days counted from when the server
 * heard of the delete. Zero days left, or an item past its 30 days that's
 * waiting for the daily job, reads as less than a day.
 */
export function daysLeftLabel(heardAt: string, now: Date): string {
  const left = Date.parse(heardAt) + RETENTION_DAYS * DAY_MS - now.getTime()
  const days = Math.floor(left / DAY_MS)
  if (!(days > 0)) return 'Less than a day left'
  return days === 1 ? '1 day left' : `${days} days left`
}

export type DeletedRow =
  | { kind: 'piece'; piece: Piece; heardAt: string }
  | { kind: 'photo'; photo: Photo; piece?: Piece; heardAt: string }

/**
 * The server's list, kept to what is still deleted here. An item put back on
 * this device but not yet synced drops out at once; an item not yet pulled
 * waits for the next sync.
 */
export function deletedRows(
  items: DeletedItem[],
  pieces: Map<string, Piece>,
  photos: Map<string, Photo>,
): DeletedRow[] {
  const rows: DeletedRow[] = []
  for (const { kind, id, heardAt } of items) {
    if (kind === 'piece') {
      const piece = pieces.get(id)
      if (piece?.deletedAt && !piece.purgedAt) {
        rows.push({ kind, piece, heardAt })
      }
    } else {
      const photo = photos.get(id)
      if (photo?.deletedAt && !photo.purgedAt && !photo.mergedInto) {
        // A purged piece keeps its name here, but Put back makes a new one.
        const home = photo.lastPieceId
          ? pieces.get(photo.lastPieceId)
          : undefined
        rows.push({
          kind,
          photo,
          piece: home?.purgedAt ? undefined : home,
          heardAt,
        })
      }
    }
  }
  return rows
}
