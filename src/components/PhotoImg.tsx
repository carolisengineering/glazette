import { useLiveQuery } from 'dexie-react-hooks'
import type { CSSProperties } from 'react'
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

/** A stored photo, or a neutral box when there is none to show. */
export function PhotoImg({
  photoId,
  thumb,
  alt = '',
  className = '',
  style,
}: Props) {
  const photo = useLiveQuery(
    () => (photoId ? db.photos.get(photoId) : undefined),
    [photoId],
  )
  // Its own query, so a write to the row doesn't read the bytes again: the Blob
  // and its object URL stay the same, and the image doesn't reload.
  const hash = photo?.hash
  const stored = useLiveQuery(
    () => (hash ? db.photoBytes.get(hash) : undefined),
    [hash],
  )
  // A row not moved yet still holds its own bytes.
  const bytes = stored ?? photo
  const blob =
    photo && !photo.deletedAt ? (thumb ? bytes?.thumb : bytes?.blob) : undefined
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
    <img
      src={url}
      alt={alt}
      className={`object-cover ${className}`}
      style={style}
    />
  )
}
