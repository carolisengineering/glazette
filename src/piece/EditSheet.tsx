import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import {
  ClayChips,
  type Form,
  FormChips,
  fieldLabel,
  useClayPick,
  useOrderedClays,
} from '../components/PieceFields'
import { Toast } from '../components/Toast'
import { useModal } from '../components/useModal'
import { db } from '../db/db'
import { updatePiece } from '../db/ops'
import type { Piece } from '../db/types'

interface Props {
  piece: Piece
  onClose: () => void
}

/** Edit a piece's name, form and clay. */
export function EditSheet({ piece, onClose }: Props) {
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  useModal(nameRef, onClose)
  const clays = useOrderedClays()
  const current = useLiveQuery(
    () => (piece.clayId ? db.clays.get(piece.clayId) : undefined),
    [piece.clayId],
  )
  const [name, setName] = useState(piece.name ?? '')
  const [form, setForm] = useState<Form | undefined>(
    piece.form === 'other' ? undefined : piece.form,
  )
  const clay = useClayPick(piece.clayId)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; id: number }>()

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      // An empty "+ Other" keeps the current clay rather than clearing it.
      const clayId =
        clay.otherOpen && !clay.otherName.trim()
          ? piece.clayId
          : await clay.resolve()
      await updatePiece(piece.id, {
        name: name.trim() || undefined,
        form: form ?? (piece.form === 'other' ? 'other' : undefined),
        clayId,
      })
      onClose()
    } catch {
      setToast((t) => ({
        message: "Couldn't save. Free up space and try again.",
        id: (t?.id ?? 0) + 1,
      }))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-7 text-ink"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          Edit piece
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="editName" className={fieldLabel}>
            Name
          </label>
          <input
            id="editName"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name it later"
            className="h-[52px] rounded-2xl border border-border bg-surface px-4 font-serif text-[22px] text-ink outline-accent placeholder:text-[#6b7580]"
          />
        </div>
        <FormChips form={form} onChange={setForm} />
        <ClayChips
          clays={clays}
          retired={current?.deletedAt ? current : undefined}
          pick={clay}
        />
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
            disabled={saving}
            className="h-14 flex-1 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
      {toast ? (
        <Toast
          key={toast.id}
          message={toast.message}
          onDismiss={() => setToast(undefined)}
        />
      ) : null}
    </div>
  )
}
