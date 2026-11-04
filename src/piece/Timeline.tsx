import { PhotoImg } from '../components/PhotoImg'
import { STAGE_LABEL, STAGES } from '../db/stage'
import type { StageEntry } from '../db/types'

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Newest first; entries on the same day keep stage order, later stage first. */
function newestFirst(entries: StageEntry[]): StageEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage),
  )
}

interface Props {
  entries: StageEntry[]
  onDelete: (entry: StageEntry) => void
}

/** The piece's journey, one row per entry. */
export function Timeline({ entries, onDelete }: Props) {
  if (entries.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col rounded-[20px] bg-surface px-4 py-2">
      {newestFirst(entries).map((e) => (
        <li key={e.id} className="flex items-center gap-3.5 py-2.5">
          <PhotoImg
            photoId={e.photoId}
            thumb
            alt=""
            className="size-11 flex-none rounded-xl"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[16px] font-semibold">
              {STAGE_LABEL[e.stage]}
            </span>
            {e.note ? (
              <span className="truncate text-[14px] text-muted">{e.note}</span>
            ) : null}
          </div>
          <span className="flex-none text-[13px] text-muted">
            {shortDate(e.date)}
          </span>
          <button
            type="button"
            aria-label={`Delete ${STAGE_LABEL[e.stage]} entry`}
            onClick={() => onDelete(e)}
            className="flex size-11 flex-none items-center justify-center rounded-full"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5B6672"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}
