import { useState } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { type PieceView, usePieces } from '../db/queries'
import { displayName, STAGE_LABEL } from '../db/stage'
import type { ProcessedImage } from '../photos/process'
import { usePhotoUrl } from './usePhotoUrl'

interface Props {
  onPick: (pieceId: string) => void
  onNew: () => void
  /** The photo under review, shown above the sheet. */
  photo?: ProcessedImage
  onRetake?: () => void
}

const inProgress = (v: PieceView) => !v.piece.lost && v.stage !== 'fired'

function matches(v: PieceView, q: string): boolean {
  if (!q) return true
  return [displayName(v.piece), v.clayName ?? '', ...v.glazeNames].some((s) =>
    s.toLowerCase().includes(q),
  )
}

function meta(v: PieceView): string {
  return [v.stage ? STAGE_LABEL[v.stage] : undefined, v.clayName]
    .filter(Boolean)
    .join(' · ')
}

/** Which piece does this photo belong to? In-progress pieces, most recently touched first. */
export function PickPieceSheet({ onPick, onNew, photo, onRetake }: Props) {
  const views = usePieces()
  const url = usePhotoUrl(photo?.blob)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string>()

  const q = query.trim().toLowerCase()
  const visible = views
    .filter(inProgress)
    .filter((v) => matches(v, q))
    .sort((a, b) => b.piece.updatedAt.localeCompare(a.piece.updatedAt))

  // The chosen piece, or the first visible one when it is gone or filtered out.
  const selected = visible.find((v) => v.piece.id === chosen) ?? visible[0]

  return (
    <main className="mx-auto flex h-dvh max-w-[430px] flex-col overflow-hidden bg-camera">
      <div className="relative h-[250px] flex-none overflow-hidden">
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : null}
        {onRetake ? (
          <button
            type="button"
            onClick={onRetake}
            className="absolute top-12 left-5 h-11 rounded-[22px] bg-camera/60 px-4 text-[15px] font-medium text-white"
          >
            Retake
          </button>
        ) : null}
        <span className="absolute top-14 right-5 rounded-xl bg-camera/60 px-3 py-1.5 text-[13px] font-semibold tracking-[0.06em] text-white">
          Update a piece
        </span>
      </div>

      <div className="relative -mt-7 flex min-h-0 flex-1 flex-col gap-4 rounded-t-[28px] bg-background px-5 pt-2.5 pb-7 text-ink">
        <span
          aria-hidden="true"
          className="h-[5px] w-10 self-center rounded-[3px] bg-[#C5CDD5]"
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="font-serif text-[32px] leading-[1.05] font-normal">
            Which piece is this?
          </h1>
          <span className="text-[14px] text-muted">
            Showing pieces still in progress
          </span>
        </div>

        <div className="relative">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#5B6672"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="absolute top-[15px] left-4"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="text"
            aria-label="Search pieces"
            placeholder="Search pieces"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 w-full rounded-2xl border border-border bg-surface pr-4 pl-11 text-[16px] text-ink outline-accent placeholder:text-[#6b7580]"
          />
        </div>

        <div
          data-testid="pick-list"
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1"
        >
          {visible.map((v) => {
            const on = v.piece.id === selected?.piece.id
            const name = displayName(v.piece)
            return (
              <button
                key={v.piece.id}
                type="button"
                data-piece={name}
                aria-pressed={on}
                onClick={() => setChosen(v.piece.id)}
                className={`flex w-full flex-none items-center gap-3 rounded-[18px] bg-surface py-2 pr-3.5 pl-2 text-left ${
                  on ? 'border-2 border-accent' : 'border-2 border-transparent'
                }`}
              >
                <PhotoImg
                  photoId={v.latestPhotoId}
                  thumb
                  className="size-[52px] flex-none rounded-xl"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-serif text-[21px] leading-[1.1]">
                    {name}
                  </span>
                  <span className="truncate text-[13px] text-muted">
                    {meta(v)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`flex size-6 flex-none items-center justify-center rounded-full ${
                    on ? 'bg-accent' : 'border-2 border-border'
                  }`}
                >
                  {on ? (
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={onNew}
            className="flex min-h-11 flex-none items-center self-center px-3 text-[15px] font-medium text-accent"
          >
            Not here? Save as a new piece
          </button>
        </div>

        {selected ? (
          <button
            type="button"
            onClick={() => onPick(selected.piece.id)}
            className="h-14 flex-none truncate rounded-[28px] bg-accent px-5 text-[16px] font-semibold text-white"
          >
            Add to {displayName(selected.piece)}
          </button>
        ) : null}
      </div>
    </main>
  )
}
