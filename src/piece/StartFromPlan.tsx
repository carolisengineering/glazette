import { type GlazeRow, rowsAreBlank } from '../capture/GlazeRows'
import { rowsFromPlan } from '../capture/resolveGlazes'
import type { PlanLayerView } from '../db/queries'

interface Props {
  plan: PlanLayerView[] | undefined
  rows: GlazeRow[]
  setRows: (rows: GlazeRow[]) => void
}

/** Offers to fill empty glaze rows from the piece's plan. Shows only with a plan and nothing typed yet. */
export function StartFromPlan({ plan, rows, setRows }: Props) {
  if (!plan || !rowsAreBlank(rows)) return null
  return (
    <button
      type="button"
      onClick={() => setRows(rowsFromPlan(plan))}
      className="flex h-11 items-center self-start text-[15px] font-semibold text-accent"
    >
      Start from plan
    </button>
  )
}
