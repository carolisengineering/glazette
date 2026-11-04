import { Link } from '@tanstack/react-router'
import type { ProcessedImage } from '../photos/process'
import type { CaptureMode } from './store'
import { usePhotoUrl } from './usePhotoUrl'

interface Props {
  photo: ProcessedImage
  /** The New piece / Update toggle is hidden when the piece is already known. */
  showToggle: boolean
  mode: CaptureMode
  onMode: (mode: CaptureMode) => void
  onRetake: () => void
  onUse: () => void
  busy?: boolean
}

const segment =
  'flex h-11 items-center rounded-[22px] px-4 text-[14px] font-semibold'

/** The dark post-capture screen: look at the photo, then use it or retake. */
export function Review({
  photo,
  showToggle,
  mode,
  onMode,
  onRetake,
  onUse,
  busy,
}: Props) {
  const url = usePhotoUrl(photo.blob)
  return (
    <main className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-camera pt-14 pb-8 text-white">
      <div className="flex items-center justify-between px-5 pb-3">
        <Link
          to="/"
          aria-label="Close"
          className="flex size-11 items-center justify-center rounded-full bg-white/12"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        {showToggle ? (
          <div className="flex gap-0.5 rounded-[26px] bg-white/12 p-1">
            {(
              [
                ['new', 'New piece'],
                ['update', 'Update'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onMode(value)}
                className={`${segment} ${mode === value ? 'bg-white text-ink' : 'text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <span aria-hidden="true" className="size-11" />
      </div>

      <div className="mx-3 mt-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[28px] bg-[#4a5560]">
        {url ? (
          <img
            src={url}
            alt="Preview of your piece"
            className="max-h-[60vh] w-full object-contain"
          />
        ) : null}
      </div>

      <div className="flex items-center gap-3 px-5 pt-6">
        <button
          type="button"
          onClick={onRetake}
          disabled={busy}
          className="h-14 rounded-[28px] bg-white/12 px-6 text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Retake
        </button>
        <button
          type="button"
          onClick={onUse}
          disabled={busy}
          className="h-14 flex-1 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Use photo
        </button>
      </div>
    </main>
  )
}
