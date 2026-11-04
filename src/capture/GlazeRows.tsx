import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { notDeleted } from '../db/queries'
import type { GlazeApplication } from '../db/types'

export interface GlazeRow {
  /** Stable React key; not saved. */
  key: string
  glazeId?: string
  name: string
  dips?: number
  method?: GlazeApplication['method']
  note?: string
}

interface Props {
  value: GlazeRow[]
  onChange: (rows: GlazeRow[]) => void
}

const METHODS: NonNullable<GlazeApplication['method']>[] = [
  'dip',
  'brush',
  'pour',
  'spray',
]

const label = 'text-[13px] font-semibold tracking-[0.08em] text-muted uppercase'
const input =
  'h-12 min-w-0 rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink outline-accent placeholder:text-[#6b7580]'

export const newGlazeRow = (): GlazeRow => ({
  key: crypto.randomUUID(),
  name: '',
})

/** The ordered glaze list for a Glazed photo: first layer on top. */
export function GlazeRows({ value, onChange }: Props) {
  const glazes = useLiveQuery(
    async () =>
      (await db.glazes.toArray())
        .filter(notDeleted)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )

  const update = (index: number, patch: Partial<GlazeRow>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  // Removing the only row leaves one empty row, so the list is never blank.
  const remove = (index: number) => {
    const rest = value.filter((_, i) => i !== index)
    onChange(rest.length > 0 ? rest : [newGlazeRow()])
  }

  return (
    <div className="flex flex-col gap-3">
      <span className={label}>Glaze · from your library</span>
      {value.map((row, i) => {
        const n = i + 1
        const q = row.name.trim().toLowerCase()
        const suggestions = row.glazeId
          ? []
          : (glazes ?? [])
              .filter((g) => !q || g.name.toLowerCase().includes(q))
              .slice(0, 6)
        return (
          <div
            key={row.key}
            className="flex flex-col gap-2 rounded-[20px] bg-surface p-3"
          >
            <div className="flex gap-2">
              <input
                type="text"
                aria-label={`Glaze ${n}`}
                value={row.name}
                onChange={(e) =>
                  update(i, { name: e.target.value, glazeId: undefined })
                }
                placeholder="Glaze name"
                className={`${input} flex-1`}
              />
              {value.length > 1 || row.name.trim() ? (
                <button
                  type="button"
                  aria-label={`Remove glaze ${n}`}
                  onClick={() => remove(i)}
                  className="flex size-12 flex-none items-center justify-center rounded-full"
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#5B6672"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              ) : null}
            </div>
            {suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => update(i, { name: g.name, glazeId: g.id })}
                    className="flex h-11 items-center gap-2 rounded-[22px] border border-border bg-surface pr-3.5 pl-2 text-[15px] font-medium text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="size-6 rounded-full"
                      style={{ background: g.color }}
                    />
                    {g.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label={`Dips for glaze ${n}`}
                value={row.dips ?? ''}
                onChange={(e) =>
                  update(i, {
                    dips: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="Dips"
                className={`${input} w-24`}
              />
              <select
                aria-label={`Method for glaze ${n}`}
                value={row.method ?? ''}
                onChange={(e) =>
                  update(i, {
                    method: (e.target.value ||
                      undefined) as GlazeApplication['method'],
                  })
                }
                className={`${input} flex-1`}
              >
                <option value="">Method</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              aria-label={`Note for glaze ${n}`}
              value={row.note ?? ''}
              onChange={(e) => update(i, { note: e.target.value })}
              placeholder="Note · optional"
              className={input}
            />
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...value, newGlazeRow()])}
        className="flex h-11 items-center self-start text-[15px] font-semibold text-accent"
      >
        + add another glaze
      </button>
    </div>
  )
}
