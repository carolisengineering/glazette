import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Toast } from '../components/Toast'
import { db } from '../db/db'
import { updatePiece, upsertClay } from '../db/ops'
import { notDeleted } from '../db/queries'
import type { Clay, Piece } from '../db/types'
import type { ProcessedImage } from '../photos/process'
import { usePhotoUrl } from './usePhotoUrl'

type Form = NonNullable<Piece['form']>

const FORMS: { value: Form; label: string }[] = [
  { value: 'mug', label: 'Mug' },
  { value: 'bowl', label: 'Bowl' },
  { value: 'vase', label: 'Vase' },
  { value: 'plate', label: 'Plate' },
  { value: 'jar', label: 'Jar' },
]

interface Props {
  pieceId: string
  photo: ProcessedImage
  onDone: () => void
}

const label = 'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase'
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

/** Details for a piece that is already saved as Thrown. Skipping every field is fine. */
export function NewPieceSheet({ pieceId, photo, onDone }: Props) {
  const url = usePhotoUrl(photo.blob)
  const data = useLiveQuery(async () => {
    const [clays, pieces, settings] = await Promise.all([
      db.clays.toArray(),
      db.pieces.toArray(),
      db.settings.get('app'),
    ])
    return {
      clays: orderClays(clays, pieces.filter(notDeleted)),
      defaultClayId: settings?.defaultClayId,
    }
  }, [])
  const [name, setName] = useState('')
  const [form, setForm] = useState<Form>()
  const [pickedClay, setPickedClay] = useState<string>()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherName, setOtherName] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string>()

  const clayId = otherOpen ? undefined : (pickedClay ?? data?.defaultClayId)

  const done = async () => {
    if (saving) return
    setSaving(true)
    try {
      const patch: Parameters<typeof updatePiece>[1] = {}
      const trimmed = name.trim()
      if (trimmed) patch.name = trimmed
      if (form) patch.form = form
      if (otherOpen && otherName.trim()) {
        patch.clayId = await upsertClay(otherName)
      } else if (clayId) {
        patch.clayId = clayId
      }
      await updatePiece(pieceId, patch)
      onDone()
    } catch {
      setToast("Couldn't save. Free up space and try again.")
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
          <label htmlFor="pieceName" className={label}>
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

        <div className="flex flex-col gap-2">
          <span className={label}>Form</span>
          <div className="flex flex-wrap gap-2">
            {FORMS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={form === f.value}
                onClick={() => setForm(form === f.value ? undefined : f.value)}
                className={form === f.value ? chipOn : chipOff}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>Clay · from your recent</span>
          <div className="flex flex-wrap gap-2">
            {data?.clays.map((c) => {
              const on = !otherOpen && clayId === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPickedClay(c.id)
                    setOtherOpen(false)
                  }}
                  className={on ? chipOn : chipOff}
                >
                  {c.name}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={otherOpen}
              onClick={() => setOtherOpen(!otherOpen)}
              className={otherOpen ? chipOn : chipOff}
            >
              + Other
            </button>
          </div>
          {otherOpen ? (
            <input
              type="text"
              aria-label="Clay name"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              placeholder="Clay name"
              className="h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink outline-accent"
            />
          ) : null}
        </div>

        <button
          type="button"
          onClick={done}
          disabled={saving}
          className="mt-auto h-14 rounded-[28px] bg-accent text-[16px] font-semibold text-white disabled:opacity-50"
        >
          Done
        </button>
      </div>
      {toast ? (
        <Toast message={toast} onDismiss={() => setToast(undefined)} />
      ) : null}
    </main>
  )
}
