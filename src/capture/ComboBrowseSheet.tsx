import { useId, useMemo, useRef } from 'react'
import { useModal } from '../components/useModal'
import { ComboStrips } from '../glazes/ComboStrips'
import { type ComboView, comboStrips, useComboViews } from '../glazes/combos'

interface Props {
  onPick: (view: ComboView) => void
  onClose: () => void
}

/** Every shown combo, one sideways strip per bottom glaze. Tapping one picks it. */
export function ComboBrowseSheet({ onPick, onClose }: Props) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onClose)
  const views = useComboViews()
  const strips = useMemo(() => comboStrips(views ?? []), [views])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="font-serif text-[24px] leading-tight outline-none"
        >
          Combos
        </h2>
        <ComboStrips strips={strips} onSelect={onPick} />
        <button
          type="button"
          onClick={onClose}
          className="h-14 rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
        >
          Close
        </button>
      </div>
    </div>
  )
}
