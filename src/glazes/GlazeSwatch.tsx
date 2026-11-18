import { PhotoImg } from '../components/PhotoImg'
import { centerCropStyle } from './swatch'

interface Props {
  color: string
  /** Swatch photo drawn over the color. The color shows while it isn't ready. */
  photoId?: string
  /** Shape and size. */
  className?: string
}

/** A box filled with the glaze's color, with its photo (thumbnail) over it when there is one. */
export function GlazeSwatch({ color, photoId, className = '' }: Props) {
  return (
    <span
      data-testid="glaze-swatch"
      aria-hidden="true"
      className={`relative block ${className}`}
      style={{ backgroundColor: color }}
    >
      {photoId ? (
        <PhotoImg
          photoId={photoId}
          thumb
          className="absolute inset-0 size-full rounded-[inherit]"
          // Transparent so the color shows while the photo loads or is missing.
          style={{ ...centerCropStyle(1, 1), backgroundColor: 'transparent' }}
        />
      ) : null}
    </span>
  )
}
