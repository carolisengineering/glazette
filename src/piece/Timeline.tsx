import { useState } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { fromDateInput, shortDate, toDateInput } from '../db/dates'
import { compareEntries, STAGE_LABEL } from '../db/stage'
import type { StageEntry } from '../db/types'

/**
 * Ranked like the header's current stage: later stage first, then newest date.
 * Ties go the way latestEntry breaks them, later in the list first, so the top
 * row is always the step the header and the top photo call the latest.
 */
function newestFirst(entries: StageEntry[]): StageEntry[] {
  return [...entries].reverse().sort((a, b) => compareEntries(b, a))
}

interface Props {
  entries: StageEntry[]
  onDelete: (entry: StageEntry) => void
  /** Saves a step's date (undefined clears it). Failures are the caller's to report. */
  onSetDate: (entry: StageEntry, date: string | undefined) => Promise<unknown>
  /** The step whose photo is at the top, marked as the current one. */
  shownId?: string
  /** A step with a photo was tapped. */
  onShow: (entry: StageEntry) => void
}

function TrashButton({
  entry,
  onDelete,
}: {
  entry: StageEntry
  onDelete: (entry: StageEntry) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Delete ${STAGE_LABEL[entry.stage]} entry`}
      onClick={() => onDelete(entry)}
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
  )
}

const linkButton =
  'flex min-h-11 flex-none items-center text-[13px] font-semibold text-accent'

/** Edits a step's date. Saves only a complete date, not each keystroke; clearing is the Clear date button. */
function DateEditor({
  entry,
  onSetDate,
  onDone,
}: {
  entry: StageEntry
  onSetDate: Props['onSetDate']
  onDone: () => void
}) {
  const [draft, setDraft] = useState(toDateInput(entry.date))
  const change = (value: string) => {
    setDraft(value)
    if (value === toDateInput(entry.date)) return
    // Native date inputs emit '' while a field is half-edited, so only the
    // Clear date button clears. A complete, valid date saves.
    const iso = fromDateInput(value)
    if (iso) void onSetDate(entry, iso)
  }
  return (
    <div className="flex items-center gap-3 pb-2 pl-11">
      <input
        type="date"
        aria-label={`${STAGE_LABEL[entry.stage]} date`}
        value={draft}
        onChange={(ev) => change(ev.target.value)}
        className="h-11 rounded-xl border border-border bg-surface px-3 text-[16px] text-ink"
      />
      {entry.date ? (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            void onSetDate(entry, undefined)
          }}
          className={linkButton}
        >
          Clear date
        </button>
      ) : null}
      <button type="button" onClick={onDone} className={linkButton}>
        Done
      </button>
    </div>
  )
}

/**
 * The piece's journey, one row per entry. Tapping a step with a photo shows it
 * at the top; steps without a photo are slim rows with an editable date.
 */
export function Timeline({
  entries,
  onDelete,
  onSetDate,
  shownId,
  onShow,
}: Props) {
  const [editingId, setEditingId] = useState<string>()
  if (entries.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col rounded-[20px] bg-surface px-4 py-2">
      {newestFirst(entries).map((e) =>
        e.photoId ? (
          <li key={e.id} className="flex items-center gap-3.5">
            <button
              type="button"
              aria-current={e.id === shownId ? 'true' : undefined}
              onClick={() => onShow(e)}
              className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl py-2.5 text-left"
            >
              <PhotoImg
                photoId={e.photoId}
                thumb
                alt=""
                className={`size-11 flex-none rounded-xl ${e.id === shownId ? 'ring-2 ring-accent ring-offset-2' : ''}`}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`text-[16px] font-semibold ${e.id === shownId ? 'text-accent' : ''}`}
                >
                  {STAGE_LABEL[e.stage]}
                </span>
                {e.note ? (
                  <span className="truncate text-[14px] text-muted">
                    {e.note}
                  </span>
                ) : null}
              </span>
              <span className="flex-none text-[13px] text-muted">
                {e.date ? shortDate(e.date) : null}
              </span>
            </button>
            <TrashButton entry={e} onDelete={onDelete} />
          </li>
        ) : (
          <li key={e.id} className="flex flex-col py-0.5">
            <div className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className="mx-[19px] size-1.5 flex-none rounded-full bg-border"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold text-muted">
                  {STAGE_LABEL[e.stage]}
                </span>
                {e.note ? (
                  <span className="truncate text-[14px] text-muted">
                    {e.note}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditingId(editingId === e.id ? undefined : e.id)
                }
                aria-label={
                  e.date
                    ? `${STAGE_LABEL[e.stage]} date, ${shortDate(e.date)}`
                    : `Add ${STAGE_LABEL[e.stage]} date`
                }
                className={linkButton}
              >
                {e.date ? shortDate(e.date) : 'Add date'}
              </button>
              <TrashButton entry={e} onDelete={onDelete} />
            </div>
            {editingId === e.id ? (
              <DateEditor
                entry={e}
                onSetDate={onSetDate}
                onDone={() => setEditingId(undefined)}
              />
            ) : null}
          </li>
        ),
      )}
    </ul>
  )
}
