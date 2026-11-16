import { changeTime } from '../sync/records'
import { db } from './db'
import { layerDetails } from './layerDetails'
import type { GlazeApplication, PlannedLayer } from './types'

/** The layer without keys whose value is undefined, so stored rows stay clean. */
function clean(layer: PlannedLayer): PlannedLayer {
  const dips =
    Number.isFinite(layer.dips) && (layer.dips as number) > 0
      ? layer.dips
      : undefined
  return { glazeId: layer.glazeId, ...layerDetails({ ...layer, dips }) }
}

const sameLayer = (a: PlannedLayer, b: PlannedLayer) =>
  a.glazeId === b.glazeId &&
  a.dips === b.dips &&
  a.method === b.method &&
  a.note === b.note

/**
 * Sets the piece's glaze plan, or removes it when `layers` is empty. Returns
 * whether anything changed: false for a missing or deleted piece, or when the
 * plan is already these layers. Joins the caller's transaction when there is
 * one (Dexie nests db.transaction), otherwise runs in its own.
 */
export function setGlazePlan(
  pieceId: string,
  layers: PlannedLayer[],
): Promise<boolean> {
  const next = layers.map(clean)
  return db.transaction('rw', db.pieces, async () => {
    const piece = await db.pieces.get(pieceId)
    if (!piece || piece.deletedAt) return false
    const stored = piece.glazePlan ?? []
    if (
      stored.length === next.length &&
      stored.every((l, i) => sameLayer(l, next[i]))
    ) {
      return false
    }
    await db.pieces.update(pieceId, {
      glazePlan: next.length > 0 ? next : undefined,
      updatedAt: changeTime(piece, new Date().toISOString()),
    })
    return true
  })
}

/**
 * Whether the glazes used are the plan: same length, and at each position the
 * same glaze, dips and method. Notes are ignored.
 */
export function planMatches(
  plan: PlannedLayer[],
  used: Pick<GlazeApplication, 'glazeId' | 'dips' | 'method'>[],
): boolean {
  return (
    plan.length === used.length &&
    plan.every(
      (p, i) =>
        p.glazeId === used[i].glazeId &&
        p.dips === used[i].dips &&
        p.method === used[i].method,
    )
  )
}
