import { useId, useRef, useState } from 'react'
import { useModal } from '../components/useModal'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { nameKey } from '../db/rowChecks'
import type { Glaze } from '../db/types'
import type { SwatchImage } from '../photos/swatchImage'
import { GlazeSwatch } from './GlazeSwatch'

export type GlazePick = { glazeId: string } | { newName: string }

interface Props {
  title: string
  /** A line under the title. */
  sub?: string
  /** The crop being named, shown above the field. */
  preview?: { photo: SwatchImage; caption: string }
  /** Every live glaze. */
  glazes: Glaze[]
  /** A glaze id left out of the grid. */
  exclude?: string
  /** Glaze ids shown faded, marked saved, but still pickable. */
  faded?: Set<string>
  onPick: (pick: GlazePick) => void
  onCancel: () => void
}

const input =
  'h-[52px] rounded-2xl border border-border bg-surface px-4 text-[16px] text-ink placeholder:text-[#6b7580]'

/**
 * A sheet for picking one glaze from the tile grid. The name field filters the
 * tiles; a name that matches no glaze offers a last New glaze tile.
 */
export function GlazeTilePicker({
  title,
  sub,
  preview,
  glazes,
  exclude,
  faded,
  onPick,
  onCancel,
}: Props) {
  const titleId = useId()
  // The title takes focus, so the keyboard doesn't cover the tiles on open.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onCancel)
  const previewUrl = usePhotoUrl(preview?.photo.thumb)
  const [name, setName] = useState('')

  const key = nameKey(name)
  const shown = glazes.filter(
    (g) => g.id !== exclude && (!key || nameKey(g.name).includes(key)),
  )
  const isNew = !!key && !glazes.some((g) => nameKey(g.name) === key)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <div className="flex flex-col gap-1">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="font-serif text-[24px] leading-tight outline-none"
          >
            {title}
          </h2>
          {sub ? <p className="text-[15px] text-muted">{sub}</p> : null}
        </div>
        {preview ? (
          <div className="flex items-center gap-3 rounded-[18px] bg-surface p-2.5">
            <div className="size-14 flex-none overflow-hidden rounded-[14px] bg-border">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <p className="font-serif text-[19px] leading-tight">
              {preview.caption}
            </p>
          </div>
        ) : null}
        <input
          type="text"
          aria-label="Glaze name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Glaze name"
          className={input}
        />
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-3.5">
          {shown.map((g) => {
            const saved = faded?.has(g.id) ?? false
            return (
              <button
                key={g.id}
                type="button"
                data-saved={saved || undefined}
                onClick={() => onPick({ glazeId: g.id })}
                className={`flex min-w-0 flex-col items-stretch gap-1.5 bg-transparent p-0 text-ink ${
                  saved ? 'opacity-40' : ''
                }`}
              >
                <GlazeSwatch
                  color={g.color}
                  photoId={g.swatchPhotoId}
                  className="aspect-square w-full overflow-hidden rounded-[14px]"
                />
                <span className="line-clamp-2 text-center text-[14px] leading-tight font-semibold break-words">
                  {g.name}
                </span>
                {saved ? (
                  <span className="-mt-1 text-center text-[12px] text-muted">
                    saved
                  </span>
                ) : null}
              </button>
            )
          })}
          {isNew ? (
            <button
              type="button"
              onClick={() => onPick({ newName: name.trim() })}
              className="flex min-w-0 flex-col items-stretch gap-1.5 bg-transparent p-0 text-ink"
            >
              <span
                aria-hidden="true"
                className="flex aspect-square w-full items-center justify-center rounded-[14px] border-2 border-dashed border-border text-[26px] text-muted"
              >
                +
              </span>
              <span className="line-clamp-2 text-center text-[14px] leading-tight font-semibold break-words">
                New glaze
              </span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-14 flex-none rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
