import { Link, useParams } from '@tanstack/react-router'
import { PhotoImg } from '../components/PhotoImg'
import { usePieces } from '../db/queries'
import { displayName } from '../db/stage'

const STAGE_LABEL = {
  thrown: 'Thrown',
  trimmed: 'Trimmed',
  bisqued: 'Bisqued',
  glazed: 'Glazed',
  fired: 'Fired',
} as const

/** Minimal landing screen until the full piece detail is built. */
export function PieceScreen() {
  const { id } = useParams({ from: '/piece/$id' })
  const view = usePieces().find((v) => v.piece.id === id)

  return (
    <main className="mx-auto flex min-h-screen max-w-[430px] flex-col gap-4 px-5 pt-14 pb-12">
      <Link
        to="/"
        className="flex min-h-11 items-center text-base font-medium text-accent"
      >
        Shelf
      </Link>
      {view && (
        <>
          <h1 className="font-serif text-[32px] leading-none font-normal">
            {displayName(view.piece)}
          </h1>
          {view.stage && (
            <span className="text-base text-muted">
              {STAGE_LABEL[view.stage]}
            </span>
          )}
          <PhotoImg
            photoId={view.latestPhotoId}
            alt={displayName(view.piece)}
            className="aspect-square w-full rounded-card"
          />
        </>
      )}
    </main>
  )
}
