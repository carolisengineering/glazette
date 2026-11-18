import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { useModal } from '../components/useModal'
import { db } from '../db/db'
import { bytesOf, hashesHeld } from '../photos/bytes'
import { centerCropStyle } from './swatch'

interface Props {
  glazeName: string
  photoIds: string[]
  /** Called with the full photo (not the thumbnail) and its upright size. */
  onPick: (picked: { blob: Blob; width: number; height: number }) => void
  onCancel: () => void
}

/**
 * The ids whose photo row is live and whose bytes this device holds, in the
 * order given. `undefined` until the first read resolves.
 */
export function usePickablePhotoIds(photoIds: string[]): string[] | undefined {
  const key = photoIds.join(',')
  return useLiveQuery(async () => {
    const rows = (await db.photos.bulkGet(photoIds)).flatMap((p) =>
      p && !p.deletedAt ? [p] : [],
    )
    const held = await hashesHeld(
      db,
      rows.map((p) => p.hash),
    )
    return rows.filter((p) => held.has(p.hash) || p.blob).map((p) => p.id)
  }, [key])
}

/** Pick one of the fired photos of pieces wearing the glaze, to crop into its swatch. */
export function PiecePhotoGrid({
  glazeName,
  photoIds,
  onPick,
  onCancel,
}: Props) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useModal(cancelRef, onCancel)
  const ids = usePickablePhotoIds(photoIds)

  const pick = async (id: string) => {
    const photo = await db.photos.get(id)
    const bytes = photo && (await bytesOf(db, photo))
    if (!photo || !bytes) return
    onPick({ blob: bytes.blob, width: photo.width, height: photo.height })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          {`Pieces in ${glazeName}`}
        </h2>
        <ul className="grid grid-cols-3 gap-2">
          {(ids ?? []).map((id, i) => (
            <li key={id}>
              <button
                type="button"
                aria-label={`Photo ${i + 1}`}
                onClick={() => pick(id)}
                className="block aspect-square w-full overflow-hidden rounded-[14px]"
              >
                <PhotoImg
                  photoId={id}
                  thumb
                  className="size-full"
                  style={centerCropStyle(1, 1)}
                />
              </button>
            </li>
          ))}
        </ul>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
