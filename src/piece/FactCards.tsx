import type { ReactNode } from 'react'
import type { PieceDetail } from '../db/queries'

const valueText =
  'text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]'

function Fact({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-3 ${className}`}
    >
      <span className="text-[13px] text-muted">{label}</span>
      {children}
    </div>
  )
}

/** One glaze layer: its swatch dot and its name. */
function GlazeLine({ name, color }: { name: string; color?: string }) {
  return (
    <span
      data-testid="glaze-line"
      className={`flex items-start gap-1.5 ${valueText}`}
    >
      {color ? (
        <span
          aria-hidden="true"
          data-testid="glaze-dot"
          // The faint ring keeps light glazes visible on the white card.
          className="mt-[0.3em] size-3 flex-none rounded-full shadow-[inset_0_0_0_1px_rgb(22_32_42/0.18)]"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="min-w-0">{name}</span>
    </span>
  )
}

/** Glaze layers across the top, then clay and firing side by side. */
export function FactCards({ view }: { view: PieceDetail }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Fact label="Glaze" className="col-span-2">
        {view.glazeNames.length ? (
          view.glazeNames.map((name, i) => (
            // Two layers of the same glaze are allowed, so the index keeps keys unique.
            // biome-ignore lint/suspicious/noArrayIndexKey: layers have no id here and never reorder in place
            <GlazeLine key={i} name={name} color={view.glazeColors[i]} />
          ))
        ) : (
          <span className={valueText}>Not glazed yet</span>
        )}
      </Fact>
      <Fact label="Clay">
        <span className={valueText}>{view.clayName ?? 'No clay'}</span>
      </Fact>
      <Fact label="Firing">
        <span className={valueText}>
          {view.cone ? `Cone ${view.cone}` : 'Not set'}
        </span>
      </Fact>
    </div>
  )
}
