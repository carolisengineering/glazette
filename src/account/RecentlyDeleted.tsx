import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { photoFileUrl } from '../../shared/photoProtocol'
import type { DeletedItem } from '../../shared/syncProtocol'
import { PhotoImg } from '../components/PhotoImg'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { db } from '../db/db'
import { putBackPhoto, putBackPiece } from '../db/putBack'
import { displayName, latestEntry } from '../db/stage'
import type { Photo, Piece } from '../db/types'
import { bytesOf } from '../photos/bytes'
import { type DeletedRow, daysLeftLabel, deletedRows } from '../sync/deleted'
import { fetchDeleted } from '../sync/transport'
import { requestSync, useSync } from '../sync/useSync'
import { useAccount } from './useAccount'

const secondary =
  'min-h-11 shrink-0 rounded-[22px] border border-border bg-surface px-4 text-[16px] font-semibold disabled:opacity-50'
const link = 'min-h-11 self-start text-[16px] font-semibold text-accent'
const thumbClass = 'size-14 shrink-0 rounded-[10px]'

type Loaded = DeletedItem[] | 'offline' | 'error'

/** A photo's thumbnail: from this device when it holds the bytes, else the server's. */
function PhotoThumb({ photo }: { photo: Photo }) {
  // null: this device doesn't hold the bytes. undefined: still reading.
  const held = useLiveQuery(
    () => bytesOf(db, photo).then((bytes) => bytes ?? null),
    [photo.id, photo.hash, photo.blob],
  )
  const url = usePhotoUrl(held ? (held.thumb ?? held.blob) : undefined)
  const [failedHash, setFailedHash] = useState<string>()
  const box = (
    <div aria-hidden="true" className={`bg-accent-tint ${thumbClass}`} />
  )
  if (held === undefined) return box
  if (held) {
    return url ? (
      <img src={url} alt="" className={`object-cover ${thumbClass}`} />
    ) : (
      box
    )
  }
  if (failedHash === photo.hash) return box
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is a load event, not a user interaction
    <img
      src={photoFileUrl(photo.hash, 'thumb')}
      alt=""
      className={`object-cover ${thumbClass}`}
      onError={() => setFailedHash(photo.hash)}
    />
  )
}

/** The photo on a deleted piece's latest live step that has one. */
function PieceThumb({ piece }: { piece: Piece }) {
  const photoId = useLiveQuery(async () => {
    const entries = await db.entries.where('pieceId').equals(piece.id).toArray()
    return latestEntry(entries.filter((e) => e.photoId))?.photoId ?? null
  }, [piece.id])
  return (
    <PhotoImg photoId={photoId ?? undefined} thumb className={thumbClass} />
  )
}

/** What was deleted in the last 30 days, with a way to put each back. */
export function RecentlyDeleted({ onBack }: { onBack: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>()
  const [said, setSaid] = useState<{ ok: boolean; text: string }>()
  const [busyId, setBusyId] = useState<string>()
  const syncing = useSync((s) => s.syncing)
  const wasSyncing = useRef(syncing)
  const latest = useRef(0)

  const load = useCallback(async () => {
    const mine = ++latest.current
    const result = await fetchDeleted()
    if (mine !== latest.current) return
    if (result === 'signed-out') {
      void useAccount.getState().refresh()
      return
    }
    setLoaded(result)
  }, [])

  useEffect(() => {
    requestSync()
    void load()
    return () => {
      // A late answer must not land after the list has closed.
      latest.current++
    }
  }, [load])

  useEffect(() => {
    const was = wasSyncing.current
    wasSyncing.current = syncing
    if (was && !syncing) void load()
  }, [syncing, load])

  const items = Array.isArray(loaded) ? loaded : undefined
  const rows = useLiveQuery(async () => {
    if (!items) return []
    const pieceIds = new Set<string>()
    const photoIds: string[] = []
    for (const item of items) {
      if (item.kind === 'piece') pieceIds.add(item.id)
      else photoIds.push(item.id)
    }
    const photoRows = (await db.photos.bulkGet(photoIds)).filter(
      (p): p is Photo => !!p,
    )
    for (const p of photoRows) if (p.lastPieceId) pieceIds.add(p.lastPieceId)
    const pieceRows = (await db.pieces.bulkGet([...pieceIds])).filter(
      (p): p is Piece => !!p,
    )
    return deletedRows(
      items,
      new Map(pieceRows.map((p) => [p.id, p])),
      new Map(photoRows.map((p) => [p.id, p])),
    )
  }, [items])

  const putBack = async (row: DeletedRow) => {
    if (busyId) return
    const id = row.kind === 'piece' ? row.piece.id : row.photo.id
    setBusyId(id)
    setSaid(undefined)
    try {
      if (row.kind === 'piece') {
        await putBackPiece(row.piece.id)
        setSaid({ ok: true, text: `Put back ${displayName(row.piece)}.` })
      } else {
        const home = await putBackPhoto(row.photo.id)
        setSaid({
          ok: true,
          text: home
            ? `Put back the photo on ${displayName(home)}.`
            : 'Put back the photo.',
        })
      }
    } catch (error) {
      console.error(error)
      setSaid({ ok: false, text: "Couldn't put that back. Try again." })
    } finally {
      setBusyId(undefined)
    }
  }

  const now = new Date()
  return (
    <section className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className={link}>
        Back
      </button>
      <p className="text-[14px] text-muted">
        Kept for 30 days, then removed for good.
      </p>
      {said && (
        <p role={said.ok ? 'status' : 'alert'} className="text-[14px] text-ink">
          {said.text}
        </p>
      )}
      {loaded === 'offline' ? (
        <p className="text-[16px]">
          You&apos;re offline. Connect to see what&apos;s been deleted.
        </p>
      ) : loaded === 'error' ? (
        <p className="text-[16px]">Couldn&apos;t load this. Try again later.</p>
      ) : items && rows?.length === 0 ? (
        <p className="text-[16px]">
          Nothing here. Deleted pieces and photos stay for 30 days.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows?.map((row) => {
            const id = row.kind === 'piece' ? row.piece.id : row.photo.id
            const name =
              row.kind === 'piece'
                ? displayName(row.piece)
                : row.piece
                  ? `Photo from ${displayName(row.piece)}`
                  : 'Photo'
            return (
              <li key={`${row.kind}:${id}`} className="flex items-center gap-3">
                {row.kind === 'piece' ? (
                  <PieceThumb piece={row.piece} />
                ) : (
                  <PhotoThumb photo={row.photo} />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-[16px]">{name}</p>
                  <p className="text-[14px] text-muted">
                    {daysLeftLabel(row.heardAt, now)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!!busyId}
                  onClick={() => void putBack(row)}
                  className={secondary}
                >
                  Put back
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
