import { Link, useNavigate } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { fromDateInput } from '../db/dates'
import { db } from '../db/db'
import { addStageEntry, defaultNoteFor } from '../db/ops'
import { usePiecesQuery } from '../db/queries'
import {
  dayCount,
  displayName,
  nextStage,
  STAGE_LABEL,
  stagesBetween,
} from '../db/stage'
import type { Stage } from '../db/types'
import type { ProcessedImage } from '../photos/process'
import { type GlazeRow, GlazeRows, newGlazeRow } from './GlazeRows'
import { NoPhoto } from './NoPhoto'
import type { ExitTarget } from './Review'
import { resolveGlazes } from './resolveGlazes'
import { StagePicker } from './StagePicker'

interface Props {
  pieceId: string
  photo?: ProcessedImage
  /** Where Close goes: the screen's entry point, not necessarily this piece. */
  exit: ExitTarget
  /** Shown only when the piece was chosen from the pick step. */
  onChangePiece?: () => void
}

const NOTE_PLACEHOLDER: Record<Stage, string> = {
  thrown: 'Clay weight',
  trimmed: 'Handle attached, foot trimmed',
  bisqued: 'Cone 6',
  glazed: 'Dips, application',
  fired: 'Cone 6 oxidation',
}

const label = 'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase'

/** Which stage is this photo? Next stage preselected; one tap saves. */
export function StageStrip({ pieceId, photo, exit, onChangePiece }: Props) {
  const navigate = useNavigate()
  const views = usePiecesQuery()
  const view = views?.find((v) => v.piece.id === pieceId)
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const url = usePhotoUrl(photo?.blob)
  const [picked, setPicked] = useState<Stage>()
  const [note, setNote] = useState<string>()
  const [rows, setRows] = useState<GlazeRow[]>(() => [newGlazeRow()])
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)
  const { show: showToast, toast } = useToast()
  const inFlight = useRef(false)

  // Still loading: just the camera background, so nothing else flashes.
  if (!views) return <main className="min-h-dvh bg-camera" />
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center gap-4 bg-camera px-5 text-white">
        <p className="text-[16px]">This piece isn't on your shelf anymore.</p>
        <Link
          to="/"
          className="flex h-14 w-full max-w-[320px] items-center justify-center rounded-[28px] bg-accent text-[16px] font-semibold text-white"
        >
          Close
        </Link>
      </main>
    )
  }

  const current = view.stage
  // A lost piece doesn't advance from the arrow: preselect where it already is.
  const stage: Stage =
    picked ??
    (view.piece.lost && current ? current : (nextStage(current) ?? 'fired'))
  const name = displayName(view.piece)
  const days = dayCount(view.piece, new Date())
  const meta = [view.clayName, days ? `Day ${days}` : undefined]
    .filter(Boolean)
    .join(' · ')

  // Until the user types, the note follows the selected stage's default.
  const noteValue = note ?? (settings ? defaultNoteFor(stage, settings) : '')

  // Glaze rows show for Glazed itself, or when skipping past it.
  const skipsGlazed =
    stage !== 'glazed' &&
    current !== undefined &&
    stagesBetween(current, stage).includes('glazed')
  const showGlazes = stage === 'glazed' || skipsGlazed

  const saveLabel =
    stage === current
      ? photo
        ? 'Save photo'
        : 'Save'
      : `Save to ${STAGE_LABEL[stage]}`
  const summary = !current
    ? `Saves ${name} as ${STAGE_LABEL[stage]}`
    : stage === current
      ? `Adds a photo to ${STAGE_LABEL[stage]}`
      : `Moves ${name} from ${STAGE_LABEL[current]} to ${STAGE_LABEL[stage]}`

  const save = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      // One transaction, so a failed save doesn't leave new library glazes behind.
      await db.transaction(
        'rw',
        db.glazes,
        db.entries,
        db.glazeApps,
        db.pieces,
        db.photos,
        async () => {
          const glazes = showGlazes
            ? await resolveGlazes(rows, settings?.defaultCone ?? '6')
            : undefined
          await addStageEntry({
            pieceId,
            stage,
            photo,
            date: photo ? undefined : fromDateInput(dateValue),
            note: noteValue.trim() || undefined,
            glazes,
          })
        },
      )
      void navigate({
        to: '/piece/$id',
        params: { id: pieceId },
        replace: true,
      })
    } catch {
      showToast(SAVE_ERROR)
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-camera">
      {photo ? (
        <div className="relative h-[250px] flex-none overflow-hidden">
          {url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : null}
          <Link
            {...exit}
            replace
            aria-label="Close"
            className="absolute top-12 left-5 flex size-11 items-center justify-center rounded-full bg-camera/60"
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
          <span className="absolute top-14 right-5 rounded-xl bg-camera/60 px-3 py-1.5 text-[13px] font-semibold tracking-[0.06em] text-white">
            Update a piece
          </span>
        </div>
      ) : (
        <div className="flex-none px-5 pt-12 pb-4">
          <div className="flex items-center justify-between">
            <Link
              {...exit}
              replace
              aria-label="Close"
              className="flex size-11 items-center justify-center rounded-full bg-white/15"
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
            <span className="rounded-xl bg-white/15 px-3 py-1.5 text-[13px] font-semibold tracking-[0.06em] text-white">
              Update a piece
            </span>
          </div>
        </div>
      )}

      <div
        className={`relative ${photo ? '-mt-7' : ''} flex flex-1 flex-col gap-5 rounded-t-[28px] bg-background px-5 pt-2.5 pb-7 text-ink`}
      >
        <span
          aria-hidden="true"
          className="h-[5px] w-10 self-center rounded-[3px] bg-[#C5CDD5]"
        />

        {photo ? null : <NoPhoto label="No photo for this update" />}

        <div className="flex items-center gap-3 rounded-[18px] bg-surface py-2 pr-3.5 pl-2">
          <PhotoImg
            photoId={view.latestPhotoId}
            thumb
            className="size-[52px] flex-none rounded-xl"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-serif text-[22px] leading-[1.1]">
              {name}
            </span>
            <span className="truncate text-[13px] text-muted">{meta}</span>
          </span>
          {onChangePiece ? (
            <button
              type="button"
              onClick={onChangePiece}
              className="min-h-11 px-1 text-[15px] font-semibold text-accent"
            >
              Change
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={label}>
            {photo ? 'Stage for this photo' : 'Stage'}
          </span>
          <StagePicker
            value={stage}
            onChange={setPicked}
            current={current}
            captions
          />
          <span className="flex items-center gap-2 text-[15px]">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#175474"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-none"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span className="min-w-0 truncate">{summary}</span>
          </span>
        </div>

        {showGlazes ? (
          <div className="flex flex-col gap-2.5">
            {skipsGlazed ? <span className={label}>Glazes</span> : null}
            <GlazeRows value={rows} onChange={setRows} />
          </div>
        ) : null}

        {photo ? null : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="stageDate" className={label}>
              Date · optional
            </label>
            <input
              id="stageDate"
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              className="h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink outline-accent"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="stageNote" className={label}>
            Note · optional
          </label>
          <input
            id="stageNote"
            type="text"
            value={noteValue}
            onChange={(e) => setNote(e.target.value)}
            placeholder={NOTE_PLACEHOLDER[stage]}
            className="h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink outline-accent placeholder:text-[#6b7580]"
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-auto h-14 flex-none rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          {saveLabel}
        </button>
      </div>
      {toast}
    </main>
  )
}
