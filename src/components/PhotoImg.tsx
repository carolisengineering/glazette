import { useLiveQuery } from 'dexie-react-hooks'
import { type CSSProperties, useEffect, useState } from 'react'
import { db } from '../db/db'
import { usePhotoUrl } from './usePhotoUrl'

interface Props {
  photoId?: string
  /** Use the ~400px thumbnail instead of the full photo. */
  thumb?: boolean
  alt?: string
  className?: string
  style?: CSSProperties
}

/** How long to wait before each new try after a read or an image fails. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

/** What a query gives back when its read fails. */
const FAILED = 'failed' as const

/** The read's result, or FAILED instead of an error a live query would throw into render. */
function orFailed<T>(read: Promise<T>): Promise<T | typeof FAILED> {
  return read.catch(() => FAILED)
}

/** A stored photo, or a neutral box when there is none to show. */
export function PhotoImg({
  photoId,
  thumb,
  alt = '',
  className = '',
  style,
}: Props) {
  // A read or an image can fail for a moment (WebKit, just after bytes are
  // written). Each failure shows the placeholder and tries again a little
  // later, a few times. Starts over for another photo.
  const [tries, setTries] = useState({ photoId, count: 0, imageFailed: false })
  const current =
    tries.photoId === photoId
      ? tries
      : { photoId, count: 0, imageFailed: false }
  if (current !== tries) setTries(current)
  const { count } = current

  const photo = useLiveQuery(
    () => (photoId ? orFailed(db.photos.get(photoId)) : undefined),
    [photoId, count],
  )
  const row = photo === FAILED ? undefined : photo
  // Its own query, so a write to the row doesn't read the bytes again: the Blob
  // and its object URL stay the same, and the image doesn't reload.
  const hash = row?.hash
  const stored = useLiveQuery(
    () => (hash ? orFailed(db.photoBytes.get(hash)) : undefined),
    [hash, count],
  )
  const failed = photo === FAILED || stored === FAILED || current.imageFailed

  useEffect(() => {
    if (!failed || count >= RETRY_DELAYS_MS.length) return
    const timer = setTimeout(
      () => setTries({ photoId, count: count + 1, imageFailed: false }),
      RETRY_DELAYS_MS[count],
    )
    return () => clearTimeout(timer)
  }, [failed, count, photoId])

  // A row not moved yet still holds its own bytes.
  const bytes = stored === FAILED ? undefined : (stored ?? row)
  const blob =
    row && !row.deletedAt && !failed
      ? thumb
        ? bytes?.thumb
        : bytes?.blob
      : undefined
  const url = usePhotoUrl(blob)

  if (!blob || !url) {
    return (
      <div
        aria-hidden="true"
        className={`bg-accent-tint ${className}`}
        style={style}
      />
    )
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is a load event, not a user interaction
    <img
      src={url}
      alt={alt}
      className={`object-cover ${className}`}
      style={style}
      onError={() => setTries({ ...current, imageFailed: true })}
    />
  )
}
