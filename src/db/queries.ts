import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { currentStage, latestEntry, STAGES } from './stage'
import type {
  Clay,
  Glaze,
  GlazeApplication,
  Piece,
  Stage,
  StageEntry,
} from './types'

export type ShelfChip = 'all' | Stage | 'lost'

export interface PieceView {
  piece: Piece
  /** Live entries only. */
  entries: StageEntry[]
  stage?: Stage
  latestPhotoId?: string
  clayName?: string
  /** Glaze names of the latest live Glazed entry, in layering order. */
  glazeNames: string[]
}

const FIRED_FADE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** The one place that decides whether a row is live. */
export const notDeleted = (row: { deletedAt?: string }): boolean =>
  !row.deletedAt

const nameWithRetired = (row: { name: string; deletedAt?: string }): string =>
  row.deletedAt ? `${row.name} (retired)` : row.name

/** Joins raw table rows into live piece views. Deleted pieces and entries are dropped; soft delete does not cascade. */
export function buildPieceViews(
  pieces: Piece[],
  entries: StageEntry[],
  glazeApps: GlazeApplication[],
  glazes: Glaze[],
  clays: Clay[],
): PieceView[] {
  const liveEntries = entries.filter(notDeleted)
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
    const glazedEntry = latestEntry(own, 'glazed')
    const glazeNames = glazedEntry
      ? glazeApps
          .filter(
            (a) => a.entryId === glazedEntry.id && liveEntryIds.has(a.entryId),
          )
          .sort((a, b) => a.order - b.order)
          .flatMap((a) => {
            const glaze = glazeById.get(a.glazeId)
            return glaze ? [nameWithRetired(glaze)] : []
          })
      : []
    const clay = piece.clayId ? clayById.get(piece.clayId) : undefined
    return {
      piece,
      entries: own,
      stage: currentStage(own),
      latestPhotoId: latestEntry(own.filter((e) => e.photoId))?.photoId,
      clayName: clay ? nameWithRetired(clay) : undefined,
      glazeNames,
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
