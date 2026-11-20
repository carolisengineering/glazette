import { useId, useRef } from 'react'
import { PhotoImg } from '../components/PhotoImg'
import { useModal } from '../components/useModal'
import { GlazeSwatch } from '../glazes/GlazeSwatch'
import {
  firedLabel,
  type PastLayer,
  type PastPiece,
} from '../glazes/pastPieces'

interface Props {
  piece: PastPiece
  onUse: () => void
  onBack: () => void
}

/** "2 dips · Dip · thin at rim", leaving out what the layer doesn't have. */
function layerLine(layer: PastLayer): string {
  const parts: string[] = []
  if (layer.dips != null) {
    parts.push(`${layer.dips} ${layer.dips === 1 ? 'dip' : 'dips'}`)
  }
  if (layer.method) {
    parts.push(layer.method[0].toUpperCase() + layer.method.slice(1))
  }
  if (layer.note) parts.push(layer.note)
  return parts.join(' · ')
}

/**
 * A closer look at one past piece: its fired photo, and exactly how it was
 * glazed, top layer first.
 */
export function PastPieceCard({ piece, onUse, onBack }: Props) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModal(titleRef, onBack)
  const fired = firedLabel(piece.firedDate)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full max-w-[430px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-ink"
      >
        <PhotoImg
          photoId={piece.photoId}
          alt=""
          className="aspect-[4/3] w-full flex-none overflow-hidden rounded-[18px] bg-border object-cover"
        />
        <div className="flex flex-col gap-0.5">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="font-serif text-[28px] leading-[1.05] outline-none"
          >
            {piece.name}
          </h2>
          {fired ? <p className="text-[14px] text-muted">{fired}</p> : null}
        </div>
        <ol className="flex flex-col rounded-[18px] bg-surface px-3.5">
          {piece.layers.map((layer, i) => {
            const line = layerLine(layer)
            return (
              <li
                // Layers can repeat a glaze, so the position keys them.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed order
                key={i}
                className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
              >
                <GlazeSwatch
                  color={layer.color}
                  photoId={layer.swatchPhotoId}
                  className="size-9 flex-none overflow-hidden rounded-[10px]"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-[16px] leading-tight font-semibold break-words">
                    {layer.name}
                  </span>
                  {line ? (
                    <span className="text-[14px] text-muted">{line}</span>
                  ) : null}
                </div>
                {piece.layers.length > 1 ? (
                  <span className="ml-auto flex-none text-[12px] tracking-[0.08em] text-muted uppercase">
                    {i === 0 ? 'top' : 'under'}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
        <button
          type="button"
          onClick={onUse}
          className="h-14 flex-none rounded-[28px] bg-accent text-[16px] font-semibold text-white"
        >
          Use these glazes
        </button>
        <button
          type="button"
          onClick={onBack}
          className="h-14 flex-none rounded-[28px] border border-border bg-surface text-[16px] font-semibold"
        >
          Back to pieces
        </button>
      </div>
    </div>
  )
}
