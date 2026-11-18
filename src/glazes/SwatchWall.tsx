import { GlazeSwatch } from './GlazeSwatch'
import type { GlazeView } from './swatch'

const pieceCount = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`

interface Props {
  glazes: GlazeView[]
  selectedId: string
  onSelect: (id: string) => void
}

/** Three-column wall of glaze tiles: the glaze's swatch photo, else its color. */
export function SwatchWall({ glazes, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-3.5">
      {glazes.map(({ glaze, pieceIds, swatchPhotoId }) => {
        const selected = glaze.id === selectedId
        return (
          <button
            key={glaze.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(glaze.id)}
            className="flex min-w-0 flex-col items-stretch gap-1.5 bg-transparent p-0 text-left text-ink"
          >
            <span
              className={`relative block aspect-square overflow-hidden rounded-2xl ${
                selected
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-background'
                  : ''
              }`}
            >
              <GlazeSwatch
                color={glaze.color}
                photoId={swatchPhotoId}
                className="size-full"
              />
            </span>
            <span className="truncate text-center text-[14px] font-semibold">
              {glaze.name}
            </span>
            <span className="-mt-1 truncate text-center text-[13px] text-muted">
              {pieceCount(pieceIds.length)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
