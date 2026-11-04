import type { PieceDetail } from '../db/queries'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-3">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[15px] font-semibold break-words">{value}</span>
    </div>
  )
}

/** Clay, glaze and firing at a glance. */
export function FactCards({ view }: { view: PieceDetail }) {
  const glaze = view.glazeNames.length
    ? view.glazeNames.join(' + ')
    : 'Not glazed yet'
  return (
    <div className="grid grid-cols-3 gap-2">
      <Fact label="Clay" value={view.clayName ?? 'No clay'} />
      <Fact label="Glaze" value={glaze} />
      <Fact
        label="Firing"
        value={view.cone ? `Cone ${view.cone}` : 'Not set'}
      />
    </div>
  )
}
