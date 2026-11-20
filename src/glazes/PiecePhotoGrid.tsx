import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { useModal } from '../components/useModal'
import { db } from '../db/db'
import { bytesOf, hashesHeld } from '../photos/bytes'
import { centerCropStyle } from './swatch'

interface Props {
  title: string
  /** The photos to offer, as usePickablePhotoIds gives them. */
  photoIds: string[]
  /** A short line shown under a photo. */
  captionOf?: (photoId: string) => string | undefined
  /** Called with the picked photo's id, its full image (not the thumbnail) and its upright size. */
  onPick: (picked: {
    photoId: string
    blob: Blob
    width: number
    height: number
  }) => void
  onCancel: () => void
}

/**
 * The ids whose photo row is live and whose bytes this device holds, in the
 * order given.
 */
export async function pickablePhotoIds(photoIds: string[]): Promise<string[]> {
  const rows = (await db.photos.bulkGet(photoIds)).flatMap((p) =>
    p && !p.deletedAt ? [p] : [],
  )
  const held = await hashesHeld(
    db,
    rows.map((p) => p.hash),
  )
  return rows.filter((p) => held.has(p.hash) || p.blob).map((p) => p.id)
}

/** `pickablePhotoIds`, live. `undefined` until the first read resolves. */
export function usePickablePhotoIds(photoIds: string[]): string[] | undefined {
  const key = photoIds.join(',')
  return useLiveQuery(() => pickablePhotoIds(photoIds), [key])
}

const NOT_HERE = "That photo isn't on this device yet."
const READ_FAILED = "Couldn't open this photo. Try again."

/** Pick one of the fired photos of pieces, to crop into a swatch. */
export function PiecePhotoGrid({
  title,
  photoIds,
  captionOf,
  onPick,
  onCancel,
}: Props) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useModal(cancelRef, onCancel)

  // A tap while a photo is being read is ignored.
  const reading = useRef(false)
  const [problem, setProblem] = useState<string>()

  const pick = async (id: string) => {
    if (reading.current) return
    reading.current = true
    setProblem(undefined)
    try {
      const photo = await db.photos.get(id)
      const bytes = photo && (await bytesOf(db, photo))
      if (!photo || !bytes) {
        setProblem(NOT_HERE)
        return
      }
      onPick({
        photoId: id,
        blob: bytes.blob,
        width: photo.width,
        height: photo.height,
      })
    } catch {
      setProblem(READ_FAILED)
    } finally {
      reading.current = false
    }
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
          {title}
        </h2>
        <ul className="grid grid-cols-3 gap-2">
          {photoIds.map((id, i) => {
            const caption = captionOf?.(id)
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-label={
                    caption ? `Photo ${i + 1}, ${caption}` : `Photo ${i + 1}`
                  }
                  onClick={() => pick(id)}
                  className="flex w-full flex-col gap-1 text-left"
                >
                  <span className="block aspect-square w-full overflow-hidden rounded-[14px]">
                    <PhotoImg
                      photoId={id}
                      thumb
                      className="size-full"
                      style={centerCropStyle(1, 1)}
                    />
                  </span>
                  {caption ? (
                    <span className="text-[13px] leading-tight break-words text-muted">
                      {caption}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
        {problem ? (
          <p role="alert" className="text-[14px] text-ink">
            {problem}
          </p>
        ) : null}
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
