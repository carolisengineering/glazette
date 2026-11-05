import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../db/db'
import { setStudioName } from '../db/ops'
import { SAVE_ERROR, useToast } from './useToast'

const text = 'text-[13px] font-semibold tracking-[0.12em] text-muted uppercase'

/** The studio name above My Shelf. Tap to rename; Return or tapping away saves, Escape cancels. */
export function StudioName() {
  const saved = useLiveQuery(() => db.settings.get('app'), [])?.studioName
  const shown = saved ?? 'Studio'
  const [draft, setDraft] = useState<string>()
  const cancelled = useRef(false)
  const { show: showToast, toast } = useToast()

  const startEditing = () => {
    cancelled.current = false
    setDraft(saved ?? '')
  }

  const finish = async () => {
    if (draft === undefined) return
    const value = draft
    setDraft(undefined)
    if (cancelled.current || value.trim() === (saved ?? '')) return
    try {
      await setStudioName(value)
    } catch {
      showToast(SAVE_ERROR)
    }
  }

  return (
    <>
      {draft === undefined ? (
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Edit studio name, ${shown}`}
          className={`${text} min-h-11 -my-3 max-w-full self-start truncate text-left`}
        >
          {shown}
        </button>
      ) : (
        <input
          type="text"
          aria-label="Studio name"
          // biome-ignore lint/a11y/noAutofocus: the field replaces the label the user just tapped
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void finish()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
          enterKeyHint="done"
          autoCapitalize="words"
          className="h-9 w-full max-w-[260px] self-start rounded-[10px] border-[1.5px] border-accent bg-surface px-2.5 text-[16px] font-semibold tracking-[0.04em] text-ink outline-none"
        />
      )}
      {toast}
    </>
  )
}
