import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
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
import { updatePiece } from '../db/ops'
import { liveDefaultClayId } from '../db/queries'
import type { ProcessedImage } from '../photos/process'

interface Props {
  pieceId: string
  photo: ProcessedImage
  onDone: () => void
  /** Discards the just-saved piece and starts the capture over. */
  onRetake: () => void
}

/** Details for a piece that is already saved as Thrown. Skipping every field is fine. */
export function NewPieceSheet({ pieceId, photo, onDone, onRetake }: Props) {
  const url = usePhotoUrl(photo.blob)
  const clays = useOrderedClays()
  // Boxed so "no default clay" is distinguishable from "not read yet".
  const defaults = useLiveQuery(
    async () => ({ clayId: await liveDefaultClayId() }),
    [],
  )
  const [name, setName] = useState('')
  const [form, setForm] = useState<Form>()
  const clay = useClayPick(defaults?.clayId)
  const [saving, setSaving] = useState(false)
  // The chips and Done wait for both reads, so Done can never drop the default clay.
  const ready = clays !== undefined && defaults !== undefined
  const { show: showToast, toast } = useToast()

  const done = async () => {
    if (saving) return
    setSaving(true)
    try {
      const patch: Parameters<typeof updatePiece>[1] = {}
      const trimmed = name.trim()
      if (trimmed) patch.name = trimmed
      if (form) patch.form = form
      const clayId = await clay.resolve()
      if (clayId) patch.clayId = clayId
      await updatePiece(pieceId, patch)
      onDone()
    } catch {
      showToast(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-background text-ink">
      <div className="relative h-[300px] flex-none overflow-hidden bg-camera">
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : null}
        <button
          type="button"
          onClick={onRetake}
          disabled={saving}
          className="absolute top-12 left-5 h-11 rounded-[22px] bg-camera/60 px-4 text-[15px] font-medium text-white disabled:opacity-50"
        >
          Retake
        </button>
      </div>
      <div className="relative -mt-7 flex flex-1 flex-col gap-5 rounded-t-[28px] bg-background px-5 pt-[22px] pb-7">
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
            Saved to your shelf as Thrown
          </span>
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
            className="h-[52px] rounded-2xl border border-border bg-surface px-4 font-serif text-[22px] text-ink outline-accent placeholder:text-[#6b7580]"
          />
        </div>

        <FormChips form={form} onChange={setForm} />
        <ClayChips clays={ready ? clays : undefined} pick={clay} />

        <button
          type="button"
          onClick={done}
          disabled={saving || !ready}
          className="mt-auto h-14 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Done
        </button>
      </div>
      {toast}
    </main>
  )
}
