import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PhotoImg } from '../components/PhotoImg'

interface Props {
  photoId?: string
  alt: string
  /** Called when the photo has loaded. */
  onShown?: () => void
  /** Opens the details of the step shown. Without it there is no Edit step button. */
  onEdit?: () => void
  /** Overlay at the bottom of the photo, such as the before/after toggle. */
  children?: ReactNode
}

/** The big photo at the top of the piece, with the way back to the shelf. */
export function Hero({ photoId, alt, onShown, onEdit, children }: Props) {
  return (
    <div className="relative h-[400px] flex-none">
      <PhotoImg
        photoId={photoId}
        alt={alt}
        className="size-full"
        onShown={onShown}
      />
      <Link
        to="/"
        aria-label="Back to shelf"
        className="absolute top-[52px] left-5 flex size-11 items-center justify-center rounded-full bg-white/85"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#16202A"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </Link>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="absolute top-[52px] right-5 flex h-11 items-center gap-1.5 rounded-full bg-white/85 px-4 text-[15px] font-semibold text-ink"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </svg>
          Edit step
        </button>
      ) : null}
      {children}
    </div>
  )
}
