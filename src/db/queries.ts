import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { planMatches } from './glazePlan'
import { DEFAULT_GLAZE_COLOR } from './seed'
import { currentStage, glazeStep, latestEntry, STAGES } from './stage'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Piece,
  Stage,
  StageEntry,
} from './types'

export type ShelfChip = 'all' | Stage | 'lost'

/** One planned glaze layer with its library glaze's name and swatch color. */
export interface PlanLayerView {
  glazeId: string
  /** The library glaze's plain name. Blank when the glaze isn't on this device yet. */
  name: string
  /** The library glaze was deleted; the Glaze box shows a ` (retired)` suffix. */
  retired?: boolean
  color: string
  dips?: number
  method?: GlazeApplication['method']
  note?: string
}

export interface PieceView {
  piece: Piece
  /** Live entries only. */
  entries: StageEntry[]
  stage?: Stage
  latestPhotoId?: string
  clayName?: string
  /**
   * The piece's glaze step (see `glazeStep`): the Glazed step these layers come
   * from and the one every glaze editor changes. Undefined before Glazed.
   */
  glazeStepId?: string
  /** Glaze names of the glaze step, in layering order. */
  glazeNames: string[]
  /** The same layers with their swatch colors, for showing each one on its own. */
  glazeLayers: {
    name: string
    color: string
    dips?: number
    method?: GlazeApplication['method']
    note?: string
  }[]
  /**
   * How many live layers the glaze step has, including ones whose library glaze
   * hasn't synced yet (those aren't in `glazeLayers`).
   */
  glazeLayerCount: number
  /**
   * The one "plan comes first" rule: the piece has a plan and no live glaze
   * layers yet, so glaze rows start from the plan and the Glaze box shows it.
   */
  startsFromPlan: boolean
  /** Every planned layer in order, nameless ones included. Empty without a plan. */
  planLayers: PlanLayerView[]
  /**
   * Whether the plan equals the glaze step's live layers. Undefined unless the
   * piece has a plan and at least one live layer on its glaze step.
   */
  planMatches?: boolean
}

const FIRED_FADE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** The one place that decides whether a row is live. */
export const notDeleted = (row: { deletedAt?: string }): boolean =>
  !row.deletedAt

const nameWithRetired = (row: { name: string; deletedAt?: string }): string =>
  row.deletedAt ? `${row.name} (retired)` : row.name

/** Joins raw table rows into live piece views. Deleted pieces, entries and glaze layers are dropped; soft delete does not cascade. */
export function buildPieceViews(
  pieces: Piece[],
  entries: StageEntry[],
  allGlazeApps: GlazeApplication[],
  glazes: Glaze[],
  clays: Clay[],
): PieceView[] {
  const liveEntries = entries.filter(notDeleted)
  const glazeApps = allGlazeApps.filter(notDeleted)
  const entriesByPiece = new Map<string, StageEntry[]>()
  for (const e of liveEntries) {
    const list = entriesByPiece.get(e.pieceId)
    if (list) list.push(e)
    else entriesByPiece.set(e.pieceId, [e])
  }
  const liveEntryIds = new Set(liveEntries.map((e) => e.id))
  const glazeById = new Map(glazes.map((g) => [g.id, g]))
  const clayById = new Map(clays.map((c) => [c.id, c]))

  return pieces.filter(notDeleted).map((piece) => {
    const own = entriesByPiece.get(piece.id) ?? []
    const glazedEntry = glazeStep(own, glazeApps)
    const liveApps = glazedEntry
      ? glazeApps
          .filter(
            (a) => a.entryId === glazedEntry.id && liveEntryIds.has(a.entryId),
          )
          .sort((a, b) => a.order - b.order)
      : []
    const layers = liveApps.flatMap((a) => {
      const glaze = glazeById.get(a.glazeId)
      return glaze ? [{ glaze, app: a }] : []
    })
    const glazeNames = layers.map((l) => nameWithRetired(l.glaze))
    const plan = piece.glazePlan ?? []
    const planLayers: PlanLayerView[] = plan.map((p) => {
      const glaze = glazeById.get(p.glazeId)
      const out: PlanLayerView = {
        glazeId: p.glazeId,
        name: glaze?.name ?? '',
        color: glaze?.color ?? DEFAULT_GLAZE_COLOR,
      }
      if (glaze?.deletedAt) out.retired = true
      if (p.dips !== undefined) out.dips = p.dips
      if (p.method !== undefined) out.method = p.method
      if (p.note !== undefined) out.note = p.note
      return out
    })
    const used = glazedEntry
      ? glazeApps
          .filter((a) => a.entryId === glazedEntry.id)
          .sort((a, b) => a.order - b.order)
      : []
    const clay = piece.clayId ? clayById.get(piece.clayId) : undefined
    return {
      piece,
      entries: own,
      stage: currentStage(own),
      latestPhotoId: latestEntry(own.filter((e) => e.photoId))?.photoId,
      clayName: clay ? nameWithRetired(clay) : undefined,
      glazeStepId: glazedEntry?.id,
      glazeNames,
      glazeLayers: layers.map(({ glaze, app }, i) => {
        const out: PieceView['glazeLayers'][number] = {
          name: glazeNames[i],
          color: glaze.color,
        }
        if (app.dips !== undefined) out.dips = app.dips
        if (app.method !== undefined) out.method = app.method
        if (app.note !== undefined) out.note = app.note
        return out
      }),
      glazeLayerCount: liveApps.length,
      startsFromPlan: planLayers.length > 0 && liveApps.length === 0,
      planLayers,
      planMatches:
        plan.length > 0 && used.length > 0
          ? planMatches(plan, used)
          : undefined,
    }
  })
}

/** Live pieces, newest activity first. `undefined` until the first read resolves. */
export function usePiecesQuery(): PieceView[] | undefined {
  return useLiveQuery(async () => {
    const [pieces, entries, glazeApps, glazes, clays] = await Promise.all([
      db.pieces.toArray(),
      db.entries.toArray(),
      db.glazeApps.toArray(),
      db.glazes.toArray(),
      db.clays.toArray(),
    ])
    return buildPieceViews(pieces, entries, glazeApps, glazes, clays).sort(
      (a, b) => b.piece.updatedAt.localeCompare(a.piece.updatedAt),
    )
  }, [])
}

/** Live pieces, newest activity first. Empty until the first read resolves. */
export function usePieces(): PieceView[] {
  return usePiecesQuery() ?? []
}

function isFadedFromAll(view: PieceView, now: Date): boolean {
  if (view.stage !== 'fired') return false
  const fired = latestEntry(view.entries, 'fired')
  if (!fired) return false
  if (!fired.date) return true
  return (
    now.getTime() - new Date(fired.date).getTime() > FIRED_FADE_DAYS * DAY_MS
  )
}

export function filterShelf(
  views: PieceView[],
  chip: ShelfChip,
  now: Date,
): PieceView[] {
  if (chip === 'lost') return views.filter((v) => v.piece.lost)
  const found = views.filter((v) => !v.piece.lost)
  if (chip === 'all') return found.filter((v) => !isFadedFromAll(v, now))
  return found.filter((v) => v.stage === chip)
}

export function chipCounts(
  views: PieceView[],
  now: Date,
): Record<ShelfChip, number> {
  const counts = { all: filterShelf(views, 'all', now).length } as Record<
    ShelfChip,
    number
  >
  for (const chip of [...STAGES, 'lost'] as const) {
    counts[chip] = filterShelf(views, chip, now).length
  }
  return counts
}

/** The default clay's id, or undefined when none is set or it has been retired. */
export async function liveDefaultClayId(): Promise<string | undefined> {
  const settings = await db.settings.get('app')
  if (!settings?.defaultClayId) return undefined
  const clay = await db.clays.get(settings.defaultClayId)
  return clay && !clay.deletedAt ? clay.id : undefined
}

export interface PieceDetail extends PieceView {
  /** Cone of the first glaze with one on the glaze step, else the default cone. */
  cone?: string
}

/**
 * One live piece with its history. `undefined` while loading, `null` when the
 * piece is missing or deleted. Reads only this piece's rows.
 */
export function usePiece(id: string): PieceDetail | null | undefined {
  return useLiveQuery(async () => {
    const piece = await db.pieces.get(id)
    if (!piece || !notDeleted(piece)) return null
    const [entries, glazeApps, clay, settings] = await Promise.all([
      db.entries.where('pieceId').equals(id).toArray(),
      db.glazeApps.where('pieceId').equals(id).filter(notDeleted).toArray(),
      piece.clayId ? db.clays.get(piece.clayId) : undefined,
      db.settings.get('app'),
    ])
    const glazeIds = new Set([
      ...glazeApps.map((a) => a.glazeId),
      ...(piece.glazePlan ?? []).map((l) => l.glazeId),
    ])
    const glazes = (await db.glazes.bulkGet([...glazeIds])).filter(
      (g) => g !== undefined,
    )
    const [view] = buildPieceViews(
      [piece],
      entries,
      glazeApps,
      glazes,
      clay ? [clay] : [],
    )
    const glazeById = new Map(glazes.map((g) => [g.id, g]))
    const glazedCone = glazeApps
      .filter((a) => a.entryId === view.glazeStepId)
      .sort((a, b) => a.order - b.order)
      .map((a) => glazeById.get(a.glazeId)?.cone)
      .find(Boolean)
    return { ...view, cone: glazedCone ?? settings?.defaultCone }
  }, [id])
}
