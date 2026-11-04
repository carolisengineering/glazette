import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PhotoImg } from '../components/PhotoImg'

interface Props {
  photoId?: string
  alt: string
  /** Overlay at the bottom of the photo, such as the before/after toggle. */
  children?: ReactNode
}

/** The big photo at the top of the piece, with the way back to the shelf. */
export function Hero({ photoId, alt, children }: Props) {
  return (
    <div className="relative h-[400px] flex-none">
      <PhotoImg photoId={photoId} alt={alt} className="size-full" />
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
      {children}
    </div>
  )
}
