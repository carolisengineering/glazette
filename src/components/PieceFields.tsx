import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { upsertClay } from '../db/ops'
import { notDeleted } from '../db/queries'
import type { Clay, Piece } from '../db/types'

export type Form = NonNullable<Piece['form']>

const FORMS: { value: Form; label: string }[] = [
  { value: 'mug', label: 'Mug' },
  { value: 'bowl', label: 'Bowl' },
  { value: 'vase', label: 'Vase' },
  { value: 'plate', label: 'Plate' },
  { value: 'jar', label: 'Jar' },
]

export const fieldLabel =
  'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase'
const chip = 'h-11 rounded-[22px] px-4 text-[15px] font-medium'
const chipOn = `${chip} bg-ink text-white`
const chipOff = `${chip} border border-border bg-surface text-ink`

/** Live clays, most recently used first, then unused ones alphabetically. */
function orderClays(clays: Clay[], pieces: Piece[]): Clay[] {
  const lastUsed = new Map<string, string>()
  for (const p of pieces) {
    if (!p.clayId) continue
    const prev = lastUsed.get(p.clayId)
    if (!prev || p.updatedAt > prev) lastUsed.set(p.clayId, p.updatedAt)
  }
  return clays.filter(notDeleted).sort((a, b) => {
    const ua = lastUsed.get(a.id)
    const ub = lastUsed.get(b.id)
    if (ua && ub) return ub.localeCompare(ua)
    if (ua) return -1
    if (ub) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Live clays in chip order. `undefined` until the first read resolves. */
export function useOrderedClays(): Clay[] | undefined {
  return useLiveQuery(async () => {
    const [clays, pieces] = await Promise.all([
      db.clays.toArray(),
      db.pieces.toArray(),
    ])
    return orderClays(clays, pieces.filter(notDeleted))
  }, [])
}

/** The clay choice: a picked chip, falling back to `fallbackId`, or a typed "+ Other" name. */
export function useClayPick(fallbackId?: string) {
  const [picked, setPicked] = useState<string>()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherName, setOtherName] = useState('')
  const clayId = otherOpen ? undefined : (picked ?? fallbackId)
  return {
    clayId,
    otherOpen,
    otherName,
    pick: (id: string) => {
      setPicked(id)
      setOtherOpen(false)
    },
    toggleOther: () => setOtherOpen((o) => !o),
    setOtherName,
    /**
     * The clay id to save. Creates the typed clay when "+ Other" has a name; an
     * open but empty "+ Other" keeps the picked or current clay.
     */
    resolve: async (): Promise<string | undefined> => {
      if (!otherOpen) return clayId
      return otherName.trim() ? upsertClay(otherName) : (picked ?? fallbackId)
    },
  }
}

export function FormChips({
  form,
  onChange,
}: {
  form?: Form
  onChange: (form: Form | undefined) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabel}>Form</span>
      <div className="flex flex-wrap gap-2">
        {FORMS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={form === f.value}
            onClick={() => onChange(form === f.value ? undefined : f.value)}
            className={form === f.value ? chipOn : chipOff}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ClayChips({
  clays,
  retired,
  pick,
}: {
  clays?: Clay[]
  /** A deleted clay the piece still uses; stays selectable until changed. */
  retired?: Clay
  pick: ReturnType<typeof useClayPick>
}) {
  const { clayId, otherOpen } = pick
  const all = retired ? [retired, ...(clays ?? [])] : clays
  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabel}>Clay · from your recent</span>
      <div className="flex flex-wrap gap-2">
        {all?.map((c) => {
          const on = !otherOpen && clayId === c.id
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => pick.pick(c.id)}
              className={on ? chipOn : chipOff}
            >
              {c.deletedAt ? `${c.name} (retired)` : c.name}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={otherOpen}
          onClick={pick.toggleOther}
          className={otherOpen ? chipOn : chipOff}
        >
          + Other
        </button>
      </div>
      {otherOpen ? (
        <input
          type="text"
          aria-label="Clay name"
          value={pick.otherName}
          onChange={(e) => pick.setOtherName(e.target.value)}
          placeholder="Clay name"
          className="h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink outline-accent"
        />
      ) : null}
    </div>
  )
}
