import { useEffect, useId, useRef, useState } from 'react'
import { type GlazeRow, GlazeRows } from '../capture/GlazeRows'
import { loadGlazeRows, resolveGlazes } from '../capture/resolveGlazes'
import { PhotoImg } from '../components/PhotoImg'
import { fieldLabel } from '../components/PieceFields'
import { useModal } from '../components/useModal'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { fromDateInput, toDateInput } from '../db/dates'
import { db } from '../db/db'
import { STAGE_LABEL } from '../db/stage'
import { type PhotoSwap, saveStepDetails, setStepGlazes } from '../db/stepEdits'
import type { StageEntry } from '../db/types'
import type { ProcessedImage } from '../photos/process'
import { usePhotoPicker } from '../photos/usePhotoPicker'
import { track } from '../telemetry/telemetry'

interface Props {
  entry: StageEntry
  /**
   * The piece's glaze step (see `glazeStep`). A Glazed step's sheet edits that
   * step's glazes, which may not be its own: a later Glazed photo has none.
   */
  glazeStepId?: string
  onClose: () => void
  onSaved: (swap: PhotoSwap | undefined) => void
}

const field =
  'h-12 rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink placeholder:text-[#6b7580]'
const linkButton =
  'flex h-11 items-center text-[15px] font-semibold text-accent'

/** Edit one step's photo, date, note and (Glazed steps) the piece's glazes. Nothing is written until Save. */
export function StepSheet({ entry, glazeStepId, onClose, onSaved }: Props) {
  const titleId = useId()
  const photoRef = useRef<HTMLButtonElement>(null)
  useModal(photoRef, onClose)
  const glazesOn =
    entry.stage === 'glazed' ? (glazeStepId ?? entry.id) : undefined
  const [photo, setPhoto] = useState<ProcessedImage>()
  const previewUrl = usePhotoUrl(photo?.thumb ?? photo?.blob)
  const [note, setNote] = useState(entry.note ?? '')
  const [dateField, setDateField] = useState(toDateInput(entry.date))
  const [cleared, setCleared] = useState(false)
  const [rows, setRows] = useState<GlazeRow[]>()
  const [saving, setSaving] = useState(false)
  const { show: showToast, toast } = useToast()

  const picker = usePhotoPicker((picked) => {
    setPhoto(picked)
    setDateField(toDateInput(picked.takenAt))
    setCleared(false)
  }, showToast)

  useEffect(() => {
    if (!glazesOn) return
    let active = true
    loadGlazeRows(glazesOn).then(
      (loaded) => {
        if (active) setRows(loaded)
      },
      // Without the rows the section stays hidden and Save leaves glazes alone.
      () => {},
    )
    return () => {
      active = false
    }
  }, [glazesOn])

  // Native date inputs report '' while a field is half-edited, so an empty
  // field clears the date only after Clear date. The same day as stored keeps
  // the stored time, so the step doesn't move in the journey.
  const dateToSave = (): string | undefined => {
    if (dateField === toDateInput(entry.date)) return entry.date
    return fromDateInput(dateField) ?? (cleared ? undefined : entry.date)
  }
  const hasDate = dateField !== '' || (!cleared && entry.date !== undefined)

  const save = async () => {
    if (saving || picker.processing) return
    setSaving(true)
    try {
      // One transaction, so a failed save doesn't leave new library glazes behind.
      const swap = await db.transaction(
        'rw',
        [
          db.pieces,
          db.entries,
          db.glazeApps,
          db.glazes,
          db.settings,
          db.photos,
          db.photoBytes,
        ],
        async () => {
          const swap = await saveStepDetails({
            entryId: entry.id,
            note,
            date: dateToSave(),
            photo,
          })
          if (glazesOn && rows) {
            const glazes = await resolveGlazes(
              rows,
              (await db.settings.get('app'))?.defaultCone ?? '6',
            )
            await setStepGlazes(glazesOn, glazes)
          }
          return swap
        },
      )
      track('piece_edited', { part: 'step' })
      onSaved(swap)
      onClose()
    } catch {
      showToast(SAVE_ERROR)
      setSaving(false)
    }
  }

  const busy = saving || picker.processing
  const hasPhoto = photo !== undefined || entry.photoId !== undefined

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          {STAGE_LABEL[entry.stage]} step
        </h2>
        <div className="flex flex-col gap-2">
          <button
            ref={photoRef}
            type="button"
            onClick={picker.open}
            disabled={busy}
            className={`relative flex h-[220px] flex-none items-center justify-center overflow-hidden rounded-[20px] disabled:opacity-60 ${hasPhoto ? 'bg-accent-tint' : 'flex-col gap-2 border-[1.5px] border-dashed border-border text-muted'}`}
          >
            {photo ? (
              previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null
            ) : entry.photoId ? (
              <PhotoImg
                photoId={entry.photoId}
                alt=""
                className="absolute inset-0 size-full"
              />
            ) : (
              <svg
                aria-hidden="true"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            )}
            {hasPhoto ? (
              <span className="absolute right-3 bottom-3 flex h-9 items-center rounded-[18px] bg-camera/60 px-3.5 text-[14px] font-medium text-white">
                Change photo
              </span>
            ) : (
              <span className="text-[15px] font-medium">Add photo</span>
            )}
          </button>
          {picker.processing ? (
            <p role="status" className="text-[14px] text-muted">
              Getting your photo ready…
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stepDate" className={fieldLabel}>
            Date
          </label>
          <div className="flex items-center gap-3">
            <input
              id="stepDate"
              type="date"
              value={dateField}
              onChange={(e) => setDateField(e.target.value)}
              className={`${field} min-w-0 flex-1`}
            />
            {hasDate ? (
              <button
                type="button"
                onClick={() => {
                  setDateField('')
                  setCleared(true)
                }}
                className={linkButton}
              >
                Clear date
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stepNote" className={fieldLabel}>
            Note
          </label>
          <input
            id="stepNote"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cone 04, 2 dips…"
            className={field}
          />
        </div>
        {glazesOn && rows ? (
          <GlazeRows value={rows} onChange={setRows} />
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-14 flex-1 rounded-[28px] border border-border bg-surface text-[16px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="h-14 flex-1 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {picker.input}
      </div>
      {toast}
    </div>
  )
}
