import { useId, useRef, useState } from 'react'
import { type GlazeRow, GlazeRows, newGlazeRow } from '../capture/GlazeRows'
import { resolveGlazes, rowsFromPlan } from '../capture/resolveGlazes'
import { useModal } from '../components/useModal'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { db } from '../db/db'
import { setGlazePlan } from '../db/glazePlan'
import type { PlanLayerView } from '../db/queries'
import type { Piece } from '../db/types'
import { track } from '../telemetry/telemetry'

interface Props {
  piece: Piece
  planLayers: PlanLayerView[]
  onClose: () => void
}

/** Edit the glazes planned for a piece, with the same rows used when logging glazes. */
export function PlanSheet({ piece, planLayers, onClose }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModal(dialogRef, onClose)
  const [rows, setRows] = useState<GlazeRow[]>(() =>
    planLayers.length > 0 ? rowsFromPlan(planLayers) : [newGlazeRow()],
  )
  const [saving, setSaving] = useState(false)
  const { show: showToast, toast } = useToast()

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      // One transaction, so a failed save doesn't leave new library glazes behind.
      const changed = await db.transaction(
        'rw',
        [db.pieces, db.glazes, db.settings],
        async () => {
          const cone = (await db.settings.get('app'))?.defaultCone ?? '6'
          return setGlazePlan(piece.id, await resolveGlazes(rows, cone))
        },
      )
      if (changed) track('piece_edited', { part: 'plan' })
      onClose()
    } catch {
      showToast(SAVE_ERROR)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          Glaze plan
        </h2>
        <GlazeRows value={rows} onChange={setRows} />
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
      {toast}
    </div>
  )
}
