import { useId, useRef } from 'react'
import { useModal } from './useModal'

interface Props {
  title: string
  body?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** A modal yes/no question. Focus starts on Cancel, Escape cancels, and focus returns on close. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useModal(cancelRef, onCancel)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-5 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-[390px] flex-col gap-4 rounded-card bg-surface p-5 text-ink shadow-lg"
      >
        <h2 id={titleId} className="font-serif text-[24px] leading-tight">
          {title}
        </h2>
        {body ? <p className="text-[16px] text-muted">{body}</p> : null}
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-3xl border border-border bg-surface text-[16px] font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-12 flex-1 rounded-3xl bg-ink text-[16px] font-semibold text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
