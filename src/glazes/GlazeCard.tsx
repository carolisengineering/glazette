import { Link } from '@tanstack/react-router'
import { PhotoImg } from '../components/PhotoImg'
import type { PieceView } from '../db/queries'
import { displayName } from '../db/stage'
import { centerCropStyle, type GlazeView } from './swatch'

interface Props {
  view: GlazeView
  pieces: PieceView[]
  onEdit: () => void
}

/** The selected glaze: swatch, name, meta line, pieces wearing it, and the tip. */
export function GlazeCard({ view, pieces, onEdit }: Props) {
  const { glaze, pieceIds, swatchPhotoId } = view
  const n = pieceIds.length
  const meta = `${glaze.cone ? `Cone ${glaze.cone} · ` : ''}used on ${n} ${n === 1 ? 'piece' : 'pieces'}`
  const ids = new Set(pieceIds)
  const used = pieces.filter((p) => ids.has(p.piece.id))
  return (
    <section
      aria-label={glaze.name}
      className="flex flex-col gap-3.5 rounded-card bg-surface p-4"
    >
      <div className="flex items-center gap-3.5">
        <div className="size-16 flex-none overflow-hidden rounded-[18px]">
          {swatchPhotoId ? (
            <PhotoImg
              photoId={swatchPhotoId}
              thumb
              className="size-full"
              style={centerCropStyle(1, 1)}
            />
          ) : (
            <div
              className="size-full"
              style={{ backgroundColor: glaze.color }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate font-serif text-[28px] leading-[1.05] font-normal">
            {glaze.name}
          </h2>
          <span className="truncate text-[14px] text-muted">{meta}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="h-11 flex-none rounded-3xl border border-border bg-surface px-4 text-[16px] font-semibold"
        >
          Edit
        </button>
      </div>
      {used.length ? (
        <ul className="flex gap-2 overflow-x-auto">
          {used.map((p) => (
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
      {glaze.notes ? (
        <p className="text-[14px] text-ink">{glaze.notes}</p>
      ) : null}
    </section>
  )
}
