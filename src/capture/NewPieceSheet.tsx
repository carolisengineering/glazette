import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { CloseIcon } from '../components/CloseIcon'
import {
  ClayChips,
  type Form,
  FormChips,
  fieldLabel,
  useClayPick,
  useOrderedClays,
} from '../components/PieceFields'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { db } from '../db/db'
import {
  addGlazesToPiece,
  createPiece,
  restagePiece,
  updatePiece,
} from '../db/ops'
import { liveDefaultClayId } from '../db/queries'
import { STAGE_LABEL } from '../db/stage'
import type { Stage } from '../db/types'
import type { ProcessedImage } from '../photos/process'
import { track } from '../telemetry/telemetry'
import { type GlazeRow, GlazeRows, newGlazeRow } from './GlazeRows'
import { NoPhoto } from './NoPhoto'
import { resolveGlazes } from './resolveGlazes'
import { StagePicker } from './StagePicker'

interface Props {
  /** With a photo the piece is already saved. Without one, nothing is written until Done. */
  pieceId?: string
  photo?: ProcessedImage
  /** With a photo, how long the piece's save took. Sent with piece_logged when the sheet ends. */
  saveMs?: number
  onDone: () => void
  /** Discards the just-saved piece and starts the capture over. Gets the stage the sheet shows. */
  onRetake?: (stage: Stage) => void
  /** Leaves the no-photo sheet without saving. */
  onClose?: () => void
}

/** Details for a new piece. Skipping every field is fine. */
export function NewPieceSheet({
  pieceId,
  photo,
  saveMs,
  onDone,
  onRetake,
  onClose,
}: Props) {
  const url = usePhotoUrl(photo?.blob)
  const clays = useOrderedClays()
  // Boxed so "no default clay" is distinguishable from "not read yet".
  const defaults = useLiveQuery(
    async () => ({ clayId: await liveDefaultClayId() }),
    [],
  )
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const [name, setName] = useState('')
  const [form, setForm] = useState<Form>()
  const clay = useClayPick(defaults?.clayId)
  const [stage, setStage] = useState<Stage>('thrown')
  const [rows, setRows] = useState<GlazeRow[]>(() => [newGlazeRow()])
  const [saving, setSaving] = useState(false)
  const restaging = useRef(false)
  // Mirrors the ref so the picker and Done visibly disable during a move.
  const [moving, setMoving] = useState(false)
  // The chips and Done wait for both reads, so Done can never drop the default clay.
  const ready = clays !== undefined && defaults !== undefined
  const { show: showToast, toast } = useToast()
  const showGlazes = stage === 'glazed' || stage === 'fired'

  // With a photo the piece was saved as Thrown before this sheet opened, so its
  // piece_logged report waits until the sheet ends, however it ends, and carries
  // the stage shown then. Retake discards the piece, so it reports nothing.
  // StrictMode's extra effect run happens only in development, where telemetry is off.
  const shownStage = useRef<Stage>('thrown')
  const discarded = useRef(false)
  const reportMs = pieceId && photo ? saveMs : undefined
  useEffect(() => {
    if (reportMs === undefined) return
    return () => {
      if (discarded.current) return
      track('piece_logged', {
        has_photo: true,
        stage: shownStage.current,
        ms: reportMs,
      })
    }
  }, [reportMs])

  const retake = () => {
    discarded.current = true
    onRetake?.(stage)
  }

  // With a photo the piece already exists, so a tap moves it right away. Taps
  // during a move are ignored, so the saved stage always matches the selection.
  const pickStage = async (next: Stage) => {
    if (next === stage) return
    if (!pieceId) {
      setStage(next)
      return
    }
    if (restaging.current || saving) return
    restaging.current = true
    setMoving(true)
    try {
      await restagePiece(pieceId, next)
      shownStage.current = next
      setStage(next)
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      restaging.current = false
      setMoving(false)
    }
  }

  const done = async () => {
    if (saving || restaging.current) return
    setSaving(true)
    try {
      const trimmed = name.trim()
      const clayId = await clay.resolve()
      // One transaction, so a failed save doesn't leave new library glazes behind.
      await db.transaction(
        'rw',
        [
          db.glazes,
          db.entries,
          db.glazeApps,
          db.pieces,
          db.photos,
          db.photoBytes,
        ],
        async () => {
          const glazes = showGlazes
            ? await resolveGlazes(rows, settings?.defaultCone ?? '6')
            : []
          if (pieceId) {
            const patch: Parameters<typeof updatePiece>[1] = {}
            if (trimmed) patch.name = trimmed
            if (form) patch.form = form
            if (clayId) patch.clayId = clayId
            await updatePiece(pieceId, patch)
            await addGlazesToPiece(pieceId, glazes)
          } else {
            await createPiece({
              stage,
              name: trimmed || undefined,
              form,
              clayId,
              glazes,
            })
          }
        },
      )
      onDone()
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-background text-ink">
      {photo ? (
        <div className="relative h-[300px] flex-none overflow-hidden bg-camera">
          {url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : null}
          <button
            type="button"
            onClick={retake}
            disabled={saving}
            className="absolute top-12 left-5 h-11 rounded-[22px] bg-camera/60 px-4 text-[15px] font-medium text-white disabled:opacity-50"
          >
            Retake
          </button>
        </div>
      ) : (
        <div className="flex flex-none flex-col gap-4 px-5 pt-12">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-full bg-surface disabled:opacity-50"
          >
            <CloseIcon stroke="currentColor" />
          </button>
          <NoPhoto label="No photo" />
        </div>
      )}
      <div
        className={`relative ${photo ? '-mt-7' : ''} flex flex-1 flex-col gap-5 rounded-t-[28px] bg-background px-5 pt-[22px] pb-[max(1.75rem,env(safe-area-inset-bottom))]`}
      >
        {photo ? (
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-accent">
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="text-[16px] font-semibold">
              Saved to your shelf as {STAGE_LABEL[stage]}
            </span>
          </div>
        ) : (
          <h1 className="font-serif text-[28px] leading-[1.1]">New piece</h1>
        )}

        <div className="flex flex-col gap-2.5">
          <span className={fieldLabel}>Stage</span>
          <StagePicker
            value={stage}
            onChange={pickStage}
            captions={false}
            disabled={saving || moving}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pieceName" className={fieldLabel}>
            Name
          </label>
          <input
            id="pieceName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name it later"
            className="h-[52px] rounded-2xl border border-border bg-surface px-4 font-serif text-[22px] text-ink placeholder:text-[#6b7580]"
          />
        </div>

        <FormChips form={form} onChange={setForm} />
        <ClayChips clays={ready ? clays : undefined} pick={clay} />

        {showGlazes ? <GlazeRows value={rows} onChange={setRows} /> : null}

        <button
          type="button"
          onClick={done}
          disabled={saving || moving || !ready}
          className="mt-auto h-14 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Done
        </button>
      </div>
      {toast}
    </main>
  )
}
