import type { ComboStrip, ComboView } from './combos'
import { GlazeSwatch } from './GlazeSwatch'

interface Props {
  strips: ComboStrip[]
  selectedId?: string
  onSelect: (view: ComboView) => void
}

/** One sideways strip of combo tiles per bottom glaze. */
export function ComboStrips({ strips, selectedId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {strips.map(({ bottom, combos }) => (
        <section key={bottom.id} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-muted">
            <GlazeSwatch
              color={bottom.color}
              photoId={bottom.swatchPhotoId}
              className="size-4 flex-none rounded-full"
            />
            Over {bottom.name}
          </h3>
          <ul className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
            {combos.map((view) => {
              const selected = view.combo.id === selectedId
              return (
                <li key={view.combo.id} className="w-[74px] flex-none">
                  <button
                    type="button"
                    aria-label={view.name}
                    aria-pressed={selected}
                    onClick={() => onSelect(view)}
                    className="flex min-h-11 w-full flex-col items-stretch gap-1 bg-transparent p-0 text-left text-ink"
                  >
                    <span
                      className={`block aspect-square overflow-hidden rounded-2xl ${
                        selected
                          ? 'ring-2 ring-accent ring-offset-2 ring-offset-background'
                          : ''
                      }`}
                    >
                      <GlazeSwatch
                        color={view.layers[0].color}
                        photoId={view.combo.swatchPhotoId}
                        className="size-full"
                      />
                    </span>
                    <span className="line-clamp-2 text-center text-[13px] leading-tight font-semibold break-words">
                      {view.label.top}
                    </span>
                    {view.label.over ? (
                      <span className="-mt-0.5 line-clamp-2 text-center text-[12px] leading-tight break-words text-muted">
                        {view.label.over}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
