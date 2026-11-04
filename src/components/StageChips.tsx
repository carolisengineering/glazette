import type { ShelfChip } from '../db/queries'
import { STAGES } from '../db/stage'

const LABELS: Record<ShelfChip, string> = {
  all: 'All',
  thrown: 'Thrown',
  trimmed: 'Trimmed',
  bisqued: 'Bisqued',
  glazed: 'Glazed',
  fired: 'Fired',
  lost: 'Lost',
}

interface Props {
  counts: Record<ShelfChip, number>
  active: ShelfChip
  onPick: (chip: ShelfChip) => void
}

export function StageChips({ counts, active, onPick }: Props) {
  const chips: ShelfChip[] = [
    'all',
    ...STAGES,
    ...(counts.lost > 0 ? (['lost'] as const) : []),
  ]
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5">
      {chips.map((chip) => {
        const on = chip === active
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(chip)}
            className={`flex min-h-11 flex-none cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium ${
              on
                ? 'bg-ink text-white'
                : 'border border-border bg-surface text-ink'
            }`}
          >
            {LABELS[chip]}
            <span
              className={`text-[13px] ${on ? 'text-white/70' : 'text-muted'}`}
            >
              {counts[chip]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
