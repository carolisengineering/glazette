import { Link } from '@tanstack/react-router'
import type { PieceView } from '../db/queries'
import {
  dayCount,
  displayName,
  nextStage,
  STAGE_LABEL,
  STAGES,
} from '../db/stage'
import { PhotoImg } from './PhotoImg'

function metaLine(view: PieceView, now: Date): string {
  const { stage, clayName, glazeNames } = view
  const parts =
    stage === 'glazed' || stage === 'fired'
      ? [glazeNames.join(', '), clayName]
      : [clayName, dayLabel(view, now)]
  return parts.filter(Boolean).join(' · ')
}

function dayLabel(view: PieceView, now: Date): string | undefined {
  const day = dayCount(view.piece, now)
  return day === undefined ? undefined : `Day ${day}`
}

export function PieceCard({ view, now }: { view: PieceView; now: Date }) {
  const { piece, stage } = view
  const name = displayName(piece)
  const reached = stage ? STAGES.indexOf(stage) + 1 : 0
  const next = nextStage(stage)
  const meta = metaLine(view, now)

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-[0_1px_2px_rgba(22,32,42,0.05)]">
      <Link
        to="/piece/$id"
        params={{ id: piece.id }}
        className="flex min-w-0 flex-col no-underline"
      >
        <div className="relative h-[148px]">
          <PhotoImg
            photoId={view.latestPhotoId}
            thumb
            alt=""
            className="size-full"
          />
          {stage && (
            <span className="absolute top-3 left-3 rounded-[10px] bg-white/80 px-[9px] py-1 text-[13px] font-semibold tracking-[0.04em] text-ink">
              {STAGE_LABEL[stage]}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-px px-3.5 pt-3 text-ink">
          <span className="truncate font-serif text-[21px] leading-[1.1]">
            {name}
          </span>
          <span className="min-h-[1.5em] truncate text-[13px] text-muted">
            {meta}
          </span>
        </div>
      </Link>
      <div className="flex items-center justify-between py-1.5 pr-3 pl-3.5">
        <div
          role="img"
          aria-label={`Stage ${reached} of 5`}
          className="flex gap-1"
        >
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={`h-1 w-3.5 rounded-sm ${i < reached ? 'bg-accent' : 'bg-border'}`}
            />
          ))}
        </div>
        {stage === 'fired' || !next ? (
          <span className="py-3 text-[13px] font-semibold text-accent">
            Out of the kiln
          </span>
        ) : (
          <Link
            to="/capture"
            search={{ pieceId: piece.id }}
            aria-label={`Move ${name} to ${STAGE_LABEL[next]}`}
            className="flex size-11 items-center justify-center rounded-full bg-accent-tint"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#175474"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        )}
      </div>
    </article>
  )
}
