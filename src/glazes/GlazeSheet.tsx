import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { fieldLabel } from '../components/PieceFields'
import { useModal } from '../components/useModal'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { db } from '../db/db'
import { DEFAULT_GLAZE_COLOR } from '../db/seed'
import { deleteGlaze, type SwatchEdit, saveGlaze } from '../db/swatch'
import type { Glaze } from '../db/types'
import { usePhotoPicker } from '../photos/usePhotoPicker'
import type { SWATCH_SOURCES } from '../telemetry/events'
import { track } from '../telemetry/telemetry'
import { CropSwatch } from './CropSwatch'
import { comboCountWith } from './combos'
import { GlazeSwatch } from './GlazeSwatch'
import { PiecePhotoGrid, usePickablePhotoIds } from './PiecePhotoGrid'

interface Props {
  /** The glaze being edited; omit to add a new one. */
  glaze?: Glaze
  /** Photo ids of fired steps on pieces wearing this glaze; empty when adding. */
  firedPhotoIds: string[]
  /** Every live glaze, for the duplicate-name check. */
  liveGlazes: Glaze[]
  defaultCone: string
  /** Called with the saved glaze's id, or nothing when closed without saving. */
  onClose: (savedId?: string) => void
}

type SwatchSource = (typeof SWATCH_SOURCES)[number]

const swatchButton =
  'h-11 rounded-[22px] border border-border bg-surface px-4 text-[15px] font-semibold disabled:opacity-50'

const input =
  'h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink placeholder:text-[#6b7580]'

/** Add or edit a glaze. Editing also offers Delete. */
export function GlazeSheet({
  glaze,
  firedPhotoIds,
  liveGlazes,
  defaultCone,
  onClose,
}: Props) {
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)
  const comboCount =
    useLiveQuery(
      async () =>
        glaze ? comboCountWith(glaze.id, await db.combos.toArray()) : 0,
      [glaze?.id],
    ) ?? 0
  // A photo waiting to be cropped, and where it came from.
  const [cropping, setCropping] = useState<{
    blob: Blob
    width: number
    height: number
    source: SwatchSource
  }>()
  const [choosingPiece, setChoosingPiece] = useState(false)
  // The confirm dialog, crop screen and piece grid handle their own Escape;
  // the sheet stays put meanwhile.
  useModal(nameRef, () => {
    if (!confirming && !cropping && !choosingPiece) onClose()
  })
  const [name, setName] = useState(glaze?.name ?? '')
  const [cone, setCone] = useState(glaze?.cone ?? '')
  const [color, setColor] = useState(glaze?.color ?? DEFAULT_GLAZE_COLOR)
  const [notes, setNotes] = useState(glaze?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const { show: showToast, toast } = useToast()
  // Swatch changes wait for Save.
  const [swatch, setSwatch] = useState<SwatchEdit>({ kind: 'keep' })
  const [swatchSource, setSwatchSource] = useState<SwatchSource>()
  const [replacing, setReplacing] = useState(false)
  const pendingUrl = usePhotoUrl(
    swatch.kind === 'set' ? swatch.image.thumb : undefined,
  )
  const pickable = usePickablePhotoIds(firedPhotoIds)
  const picker = usePhotoPicker(
    (picked) =>
      setCropping({
        blob: picked.blob,
        width: picked.width,
        height: picked.height,
        source: 'photo',
      }),
    showToast,
  )
  const hasSwatch =
    swatch.kind === 'set' || (swatch.kind === 'keep' && !!glaze?.swatchPhotoId)
  const showSources = !hasSwatch || replacing

  const trimmed = name.trim()
  const duplicate = liveGlazes.some(
    (g) =>
      g.id !== glaze?.id &&
      g.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  const canSave = !!trimmed && !duplicate && !busy

  const fail = () => {
    showToast(SAVE_ERROR)
    setBusy(false)
  }

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      const id = await saveGlaze(
        {
          id: glaze?.id,
          name: trimmed,
          cone: cone.trim() || defaultCone,
          color,
          notes: notes.trim() || undefined,
        },
        swatch,
      )
      if (swatch.kind === 'set' && swatchSource) {
        track('swatch_saved', { source: swatchSource })
      }
      onClose(id)
    } catch {
      fail()
    }
  }

  const remove = async () => {
    if (!glaze) return
    setConfirming(false)
    setBusy(true)
    try {
      await deleteGlaze(glaze.id)
      onClose()
    } catch {
      fail()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          {glaze ? 'Edit glaze' : 'Add glaze'}
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="glazeName" className={fieldLabel}>
            Name
          </label>
          <input
            id="glazeName"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={duplicate}
            aria-describedby={duplicate ? 'glazeNameError' : undefined}
            placeholder="Celadon"
            className={input}
          />
          {duplicate ? (
            <p id="glazeNameError" className="text-[14px] text-muted">
              Already in your library
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Swatch</span>
          <div className="flex items-center gap-3">
            <div className="size-[76px] shrink-0 overflow-hidden rounded-[18px]">
              {swatch.kind === 'set' && pendingUrl ? (
                <img
                  src={pendingUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : swatch.kind === 'keep' && glaze?.swatchPhotoId ? (
                <GlazeSwatch
                  color={color}
                  photoId={glaze.swatchPhotoId}
                  className="size-full"
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-[18px] border-2 border-dashed border-border px-1 text-center text-[13px] leading-tight text-muted">
                  No swatch yet
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {hasSwatch ? (
                <>
                  <button
                    type="button"
                    onClick={() => setReplacing((r) => !r)}
                    disabled={busy}
                    aria-expanded={replacing}
                    className={swatchButton}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSwatch({ kind: 'remove' })
                      setSwatchSource(undefined)
                      setReplacing(false)
                    }}
                    disabled={busy}
                    className={swatchButton}
                  >
                    Remove
                  </button>
                </>
              ) : null}
              {showSources ? (
                <>
                  <button
                    type="button"
                    onClick={picker.open}
                    disabled={busy || picker.processing}
                    className={swatchButton}
                  >
                    Add photo
                  </button>
                  {pickable && pickable.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setChoosingPiece(true)}
                      disabled={busy}
                      className={swatchButton}
                    >
                      From a piece
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          {picker.input}
        </div>
        <div className="flex gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="glazeCone" className={fieldLabel}>
              Cone
            </label>
            <input
              id="glazeCone"
              type="text"
              value={cone}
              onChange={(e) => setCone(e.target.value)}
              placeholder={defaultCone}
              className={input}
            />
          </div>
          {hasSwatch ? null : (
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="glazeColor" className={fieldLabel}>
                Color
              </label>
              <input
                id="glazeColor"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-[52px] w-full rounded-2xl border border-border bg-surface p-1.5"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="glazeNotes" className={fieldLabel}>
            Notes
          </label>
          <textarea
            id="glazeNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Tips for next time"
            className="rounded-2xl border border-border bg-surface px-4 py-3 text-[16px] text-ink placeholder:text-[#6b7580]"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onClose()}
            disabled={busy}
            className="h-14 flex-1 rounded-[28px] border border-border bg-surface text-[16px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="h-14 flex-1 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {glaze ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="h-11 self-center text-[16px] font-semibold text-ink underline disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
      {confirming && glaze ? (
        <ConfirmDialog
          title={`Delete ${glaze.name}?`}
          body={`Pieces that used it keep the name, marked (retired).${
            comboCount
              ? ` Its ${comboCount} ${comboCount === 1 ? 'combo' : 'combos'} won't show anymore.`
              : ''
          }`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {choosingPiece && glaze ? (
        <PiecePhotoGrid
          title={`Pieces in ${glaze.name}`}
          photoIds={pickable ?? []}
          onPick={(picked) => {
            setChoosingPiece(false)
            setCropping({ ...picked, source: 'piece' })
          }}
          onCancel={() => setChoosingPiece(false)}
        />
      ) : null}
      {cropping ? (
        <CropSwatch
          source={cropping.blob}
          width={cropping.width}
          height={cropping.height}
          onUse={(image) => {
            setSwatch({ kind: 'set', image })
            setSwatchSource(cropping.source)
            setReplacing(false)
            setCropping(undefined)
          }}
          onCancel={() => setCropping(undefined)}
        />
      ) : null}
      {toast}
    </div>
  )
}
