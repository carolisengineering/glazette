import { Link } from '@tanstack/react-router'
import { PhotoImg } from '../components/PhotoImg'
import { displayName } from '../db/stage'
import type { ComboView } from './combos'
import { GlazeSwatch } from './GlazeSwatch'
import { centerCropStyle } from './swatch'

interface Props {
  view: ComboView
  onEdit: () => void
}

/** The selected combo: swatch, name, how many pieces wore it, and those pieces. */
export function ComboCard({ view, onEdit }: Props) {
  const { combo, layers, name, pieces } = view
  const n = pieces.length
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-3.5 rounded-card bg-surface p-4"
    >
      <div className="flex items-center gap-3.5">
        <GlazeSwatch
          color={layers[0].color}
          photoId={combo.swatchPhotoId}
          className="size-16 flex-none rounded-[18px]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-serif text-[24px] leading-[1.1] font-normal break-words">
            {name}
          </h2>
          <span className="text-[14px] text-muted">
            used on {n} {n === 1 ? 'piece' : 'pieces'}
          </span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="h-11 flex-none rounded-3xl border border-border bg-surface px-4 text-[16px] font-semibold"
        >
          Edit
        </button>
      </div>
      {pieces.length ? (
        <ul className="flex gap-2 overflow-x-auto">
          {pieces.map((p) => (
            <li key={p.piece.id} className="flex-none">
              <Link
                to="/piece/$id"
                params={{ id: p.piece.id }}
                aria-label={displayName(p.piece)}
                className="block size-16 overflow-hidden rounded-[14px]"
              >
                <PhotoImg
                  photoId={p.latestPhotoId}
                  thumb
                  className="size-full"
                  style={centerCropStyle(1, 1)}
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
