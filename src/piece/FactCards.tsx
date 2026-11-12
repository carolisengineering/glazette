import type { ReactNode } from 'react'
import type { PieceDetail } from '../db/queries'

const valueText = 'text-[15px] leading-snug font-semibold wrap-anywhere'

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

/** Glaze layers across the top, then clay and firing side by side. */
export function FactCards({ view }: { view: PieceDetail }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Fact label="Glaze" className="col-span-2">
        {view.glazeLayers.length ? (
          <ul
            aria-label="Glazes"
            className="m-0 flex list-none flex-col gap-1 p-0"
          >
            {view.glazeLayers.map((layer, i) => (
              // The same glaze can be layered twice. Reordered layers come back as a new
              // list from the database, so an index key just re-renders each row.
              // biome-ignore lint/suspicious/noArrayIndexKey: layers carry no id here
              <li key={i} className={`flex items-start gap-1.5 ${valueText}`}>
                <span
                  aria-hidden="true"
                  data-testid="glaze-dot"
                  // The faint ring keeps light glazes visible on the white card.
                  className="mt-[0.3em] size-3 flex-none rounded-full shadow-[inset_0_0_0_1px_rgb(22_32_42/0.18)]"
                  style={{ backgroundColor: layer.color }}
                />
                <span className="min-w-0">{layer.name}</span>
              </li>
            ))}
          </ul>
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
