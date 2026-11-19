import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { notDeleted, type PieceView, usePiecesQuery } from '../db/queries'
import { glazedStepWithGlazes } from '../db/stage'
import type { Combo, Glaze, GlazeApplication } from '../db/types'

export interface ComboView {
  combo: Combo
  /** The layer glazes, top first. */
  layers: Glaze[]
  /** Layer names joined with " over ", top first. */
  name: string
  /** `over` is "over {middle name}" for three layers, absent for two. */
  label: { top: string; over?: string }
  /** Live pieces whose glaze step has exactly these layers, in order. */
  pieces: PieceView[]
}

export interface ComboStrip {
  /** The bottom (last) layer glaze. */
  bottom: Glaze
  combos: ComboView[]
}

const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })

/**
 * The combos to show: not deleted, and every layer's glaze exists and isn't
 * deleted. `pieceViews` must already be live-only (see `buildPieceViews`).
 */
export function buildComboViews(
  combos: Combo[],
  glazes: Glaze[],
  pieceViews: PieceView[],
  glazeApps: GlazeApplication[],
): ComboView[] {
  const liveApps = glazeApps.filter(notDeleted)
  const byId = new Map(glazes.filter(notDeleted).map((g) => [g.id, g]))

  // Each piece's current layers, bottom of the list last.
  const stacks = pieceViews.flatMap((view) => {
    const glazed = glazedStepWithGlazes(view.entries, liveApps)
    if (!glazed) return []
    const ids = liveApps
      .filter((a) => a.entryId === glazed.id)
      .sort((a, b) => a.order - b.order)
      .map((a) => a.glazeId)
    return [{ view, key: ids.join('|') }]
  })

  const views: ComboView[] = []
  for (const combo of combos.filter(notDeleted)) {
    const layers = combo.layers.map((id) => byId.get(id))
    if (layers.some((g) => !g)) continue
    const found = layers as Glaze[]
    const key = combo.layers.join('|')
    views.push({
      combo,
      layers: found,
      name: found.map((g) => g.name).join(' over '),
      label: {
        top: found[0].name,
        ...(found.length === 3 ? { over: `over ${found[1].name}` } : {}),
      },
      pieces: stacks.filter((s) => s.key === key).map((s) => s.view),
    })
  }
  return views
}

/** Strips by bottom glaze, alphabetical; tiles alphabetical by label. */
export function comboStrips(views: ComboView[]): ComboStrip[] {
  const strips = new Map<string, ComboStrip>()
  for (const view of views) {
    const bottom = view.layers[view.layers.length - 1]
    const strip = strips.get(bottom.id)
    if (strip) strip.combos.push(view)
    else strips.set(bottom.id, { bottom, combos: [view] })
  }
  const result = [...strips.values()].sort((a, b) =>
    compareText(a.bottom.name, b.bottom.name),
  )
  for (const strip of result) {
    strip.combos.sort(
      (a, b) =>
        compareText(a.label.top, b.label.top) ||
        compareText(a.label.over ?? '', b.label.over ?? ''),
    )
  }
  return result
}

/** `undefined` until the first read resolves. */
export function useComboViews(): ComboView[] | undefined {
  const pieceViews = usePiecesQuery()
  const rows = useLiveQuery(async () => {
    const [combos, glazes, glazeApps] = await Promise.all([
      db.combos.toArray(),
      db.glazes.toArray(),
      db.glazeApps.toArray(),
    ])
    return { combos, glazes, glazeApps }
  }, [])
  if (!pieceViews || !rows) return undefined
  return buildComboViews(rows.combos, rows.glazes, pieceViews, rows.glazeApps)
}

/** Live combos with this glaze in any layer. */
export function comboCountWith(glazeId: string, combos: Combo[]): number {
  return combos.filter((c) => notDeleted(c) && c.layers.includes(glazeId))
    .length
}
