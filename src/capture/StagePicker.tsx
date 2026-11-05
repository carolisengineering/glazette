import { nextStage, STAGE_LABEL, STAGES } from '../db/stage'
import type { Stage } from '../db/types'

interface Props {
  value: Stage
  onChange: (s: Stage) => void
  /** The piece's current stage. Undefined makes every stage selectable. */
  current?: Stage
  /** Show the Done/Now/Next captions. */
  captions: boolean
}

/** Five stage buttons with progress bars. */
export function StagePicker({ value, onChange, current, captions }: Props) {
  const currentIndex = current ? STAGES.indexOf(current) : 0
  const selectable = (s: Stage) =>
    current === 'fired' ? s === 'fired' : STAGES.indexOf(s) >= currentIndex
  return (
    <fieldset
      aria-label="Stage"
      className="m-0 grid min-w-0 grid-cols-5 gap-1 rounded-[18px] border-0 bg-surface p-1.5"
    >
      {STAGES.map((s) => {
        const on = s === value
        const ok = selectable(s)
        const past = !ok && STAGES.indexOf(s) < currentIndex
        const caption = !captions
          ? ''
          : past
            ? 'Done'
            : s === current
              ? 'Now'
              : s === nextStage(current)
                ? 'Next'
                : ''
        return (
          <button
            key={s}
            type="button"
            disabled={!ok}
            aria-pressed={on}
            onClick={() => {
              onChange(s)
            }}
            className={`flex min-h-[72px] flex-col items-center gap-1.5 rounded-[13px] px-0.5 pt-2.5 pb-2 ${
              on ? 'bg-accent text-white' : ok ? 'text-ink' : 'text-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1 w-6 rounded-sm ${
                on
                  ? 'bg-white'
                  : STAGES.indexOf(s) <= STAGES.indexOf(value)
                    ? 'bg-accent'
                    : 'bg-border'
              }`}
            />
            <span className="text-[13px] font-semibold">{STAGE_LABEL[s]}</span>
            <span
              className={`h-4 text-[13px] ${on ? 'text-white/85' : 'text-muted'}`}
            >
              {caption}
            </span>
          </button>
        )
      })}
    </fieldset>
  )
}
