import { Fragment, useId, useMemo, useRef, useState } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { useModal } from '../components/useModal'
import { GlazeSwatch } from '../glazes/GlazeSwatch'
import {
  countLine,
  filterPastPieces,
  monthLabel,
  type PastPiece,
  pastChips,
} from '../glazes/pastPieces'
import { centerCropStyle } from '../glazes/swatch'
import { PastPieceCard } from './PastPieceCard'

interface Props {
  /** Every past piece to offer, newest fired first. */
  pieces: PastPiece[]
  onUse: (piece: PastPiece) => void
  onClose: () => void
}

const chipBase =
  'flex h-9 flex-none items-center gap-1.5 rounded-full border text-[14px] font-semibold whitespace-nowrap'
const chipOff = 'border-border bg-surface text-ink'
const chipOn = 'border-accent bg-accent text-white'

/**
 * Fired photos of past pieces to repeat, narrowed by glaze chips. Tapping a
 * photo opens a closer look on top, so the chips and scroll stay as they were.
 */
export function PastPiecesSheet({ pieces, onUse, onClose }: Props) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onClose)
  const chips = useMemo(() => pastChips(pieces), [pieces])
  const [chosen, setChosen] = useState<string[]>([])
  const [looking, setLooking] = useState<PastPiece>()

  const shown = filterPastPieces(pieces, chosen)
  // Names in the order they were chosen, as she'd say them.
  const namesInOrder = chosen.flatMap((id) => {
    const c = chips.find((x) => x.glazeId === id)
    return c ? [c.name] : []
  })
  const toggle = (id: string) =>
    setChosen((now) =>
      now.includes(id) ? now.filter((x) => x !== id) : [...now, id],
    )

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex max-h-dvh w-full max-w-[430px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
        >
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="font-serif text-[24px] leading-tight outline-none"
          >
            Past pieces
          </h2>
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5">
            <button
              type="button"
              aria-pressed={chosen.length === 0}
              onClick={() => setChosen([])}
              className={`${chipBase} px-3.5 ${chosen.length === 0 ? chipOn : chipOff}`}
            >
              All
            </button>
            {chips.map((c) => {
              const on = chosen.includes(c.glazeId)
              return (
                <button
                  key={c.glazeId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c.glazeId)}
                  className={`${chipBase} pr-3 pl-1 ${on ? chipOn : chipOff}`}
                >
                  <GlazeSwatch
                    color={c.color}
                    photoId={c.swatchPhotoId}
                    className="size-7 flex-none overflow-hidden rounded-full"
                  />
                  {c.name}
                </button>
              )
            })}
          </div>
          {chosen.length > 0 ? (
            <p className="-mt-1 text-[14px] text-muted">
              {countLine(shown.length, namesInOrder)}
            </p>
          ) : null}
          <ul className="grid grid-cols-2 gap-x-2.5 gap-y-4">
            {shown.map((p) => {
              const month = monthLabel(p.firedDate)
              return (
                <li key={p.pieceId} className="min-w-0">
                  <button
                    type="button"
                    aria-label={`${p.name}: ${p.label}`}
                    onClick={() => setLooking(p)}
                    className="flex w-full min-w-0 flex-col items-stretch gap-1.5 bg-transparent p-0 text-left text-ink"
                  >
                    <span className="block aspect-square w-full overflow-hidden rounded-[16px] bg-border">
                      <PhotoImg
                        photoId={p.photoId}
                        thumb
                        className="size-full"
                        style={centerCropStyle(1, 1)}
                      />
                    </span>
                    <span className="text-[14px] leading-tight font-semibold break-words">
                      {p.layers.map((l, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: layers keep their order and can repeat a glaze
                        <Fragment key={i}>
                          {i > 0 ? (
                            <span className="font-medium text-muted">
                              {' '}
                              over{' '}
                            </span>
                          ) : null}
                          {l.name}
                        </Fragment>
                      ))}
                    </span>
                    <span className="-mt-1 text-[13px] leading-tight text-muted">
                      {month ? `${p.name} · ${month}` : p.name}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="h-14 flex-none rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
          >
            Close
          </button>
        </div>
      </div>
      {looking ? (
        <PastPieceCard
          piece={looking}
          onUse={() => onUse(looking)}
          onBack={() => setLooking(undefined)}
        />
      ) : null}
    </>
  )
}
