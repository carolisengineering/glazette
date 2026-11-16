import { type ReactNode, useState } from 'react'
import type { PieceDetail, PlanLayerView } from '../db/queries'
import type { Stage } from '../db/types'

const valueText = 'text-[15px] leading-snug font-semibold wrap-anywhere'

function Fact({
  label,
  className = '',
  action,
  children,
}: {
  label: string
  className?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-3 ${className}`}
    >
      {action ? (
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span>{label}</span>
          {action}
        </div>
      ) : (
        <span className="text-[13px] text-muted">{label}</span>
      )}
      {children}
    </div>
  )
}

const link = 'min-h-8 text-[14px] font-semibold text-accent'
const BEFORE_GLAZING: Array<Stage | undefined> = [
  undefined,
  'thrown',
  'trimmed',
  'bisqued',
]

const dipsText = (dips: number) => `${dips} ${dips === 1 ? 'dip' : 'dips'}`

/** The planned glazes: hollow rings and lighter text, so a plan never reads as glazes used. */
function PlanList({ layers }: { layers: PlanLayerView[] }) {
  return (
    <ul
      aria-label="Glaze plan"
      className="m-0 flex list-none flex-col gap-1 p-0"
    >
      {layers
        .filter((layer) => layer.name)
        .map((layer, i) => (
          // The same glaze can be planned twice, so the position is the key.
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: layers carry no id here
            key={i}
            className="flex items-start gap-1.5 text-[15px] leading-snug font-medium text-[#36414c]"
          >
            <span
              aria-hidden="true"
              data-testid="plan-ring"
              className="mt-[0.3em] size-3 flex-none rounded-full border-[2.5px] bg-transparent"
              style={{ borderColor: layer.color }}
            />
            <span className="min-w-0 wrap-anywhere">
              {layer.name}
              {layer.dips !== undefined ? (
                <small className="text-[13px] font-medium text-muted">{` · ${dipsText(layer.dips)}`}</small>
              ) : null}
              {layer.note ? (
                <small className="text-[13px] font-medium text-muted">{` · ${layer.note}`}</small>
              ) : null}
            </span>
          </li>
        ))}
    </ul>
  )
}

/** Glaze layers across the top, then clay and firing side by side. */
export function FactCards({
  view,
  onPlan,
}: {
  view: PieceDetail
  onPlan: () => void
}) {
  const [showPlan, setShowPlan] = useState(false)
  const used = view.glazeLayers.length > 0
  const hasPlan = view.planLayers.some((layer) => layer.name)
  const planning = view.planLayers.length > 0 && !used
  return (
    <div className="grid grid-cols-2 gap-2">
      <Fact
        label={planning ? 'Glaze plan' : 'Glaze'}
        className={`col-span-2 ${planning ? 'border-[1.5px] border-dashed border-[#9aa5b0] bg-transparent' : ''}`}
        action={
          planning ? (
            <button
              type="button"
              aria-label="Edit glaze plan"
              onClick={onPlan}
              className={link}
            >
              Edit
            </button>
          ) : undefined
        }
      >
        {used ? (
          <>
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
            {hasPlan ? (
              <>
                <hr className="my-1 border-0 border-t border-border" />
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>Plan</span>
                  <button
                    type="button"
                    aria-expanded={showPlan}
                    onClick={() => setShowPlan((v) => !v)}
                    className={link}
                  >
                    {showPlan ? 'Hide' : 'Show'}
                  </button>
                </div>
                <span className="text-[15px] leading-snug font-medium text-muted">
                  {view.planMatches
                    ? 'Same as plan'
                    : 'Changed in the glaze lab'}
                </span>
                {showPlan ? (
                  <>
                    <PlanList layers={view.planLayers} />
                    <button
                      type="button"
                      onClick={onPlan}
                      className={`${link} self-start`}
                    >
                      Edit plan
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : planning ? (
          <PlanList layers={view.planLayers} />
        ) : (
          <>
            <span className={valueText}>Not glazed yet</span>
            {BEFORE_GLAZING.includes(view.stage) ? (
              <button
                type="button"
                onClick={onPlan}
                className={`${link} self-start`}
              >
                + Plan glazes
              </button>
            ) : null}
          </>
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
