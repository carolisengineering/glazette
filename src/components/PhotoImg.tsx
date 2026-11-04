import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { usePhotoUrl } from './usePhotoUrl'

interface Props {
  photoId?: string
  /** Use the ~400px thumbnail instead of the full photo. */
  thumb?: boolean
  alt?: string
  className?: string
}

/** A stored photo, or a neutral box when there is none to show. */
export function PhotoImg({ photoId, thumb, alt = '', className = '' }: Props) {
  const photo = useLiveQuery(
    () => (photoId ? db.photos.get(photoId) : undefined),
    [photoId],
  )
  const blob =
    photo && !photo.deletedAt ? (thumb ? photo.thumb : photo.blob) : undefined
  const url = usePhotoUrl(blob)

  if (!blob || !url) {
    return <div aria-hidden="true" className={`bg-accent-tint ${className}`} />
  }
  return <img src={url} alt={alt} className={`object-cover ${className}`} />
}
