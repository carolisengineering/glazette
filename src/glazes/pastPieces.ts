import { useLiveQuery } from 'dexie-react-hooks'
import type { GlazeRow } from '../capture/GlazeRows'
import { db } from '../db/db'
import { layerDetails } from '../db/layerDetails'
import { buildPieceViews, notDeleted, type PieceView } from '../db/queries'
import {
  compareEntries,
  displayName,
  glazedStepWithGlazes,
  latestEntry,
} from '../db/stage'
import type { Glaze, GlazeApplication, StageEntry } from '../db/types'
import { pickablePhotoIds } from './PiecePhotoGrid'

/** One glaze layer of a past piece, as it was applied. */
export interface PastLayer {
  glazeId: string
  /** The glaze's stored name, even if it has since been deleted. */
  name: string
  color: string
  swatchPhotoId?: string
  /** False when the glaze has been deleted from the library. */
  live: boolean
  dips?: number
  method?: GlazeApplication['method']
  note?: string
}

/** A fired piece whose glazes can be repeated on another piece. */
export interface PastPiece {
  pieceId: string
  name: string
  /** The photo of the piece's newest live Fired step with a photo. */
  photoId: string
  /** That Fired step's date. */
  firedDate?: string
  /** Top layer first. */
  layers: PastLayer[]
  /** Layer names joined with " over ", top first. */
  label: string
}

/** A glaze to narrow the past pieces by. */
export interface PastChip {
  glazeId: string
  name: string
  color: string
  swatchPhotoId?: string
}

/**
 * Pieces with a fired photo and glazes on their glaze step, newest Fired step
 * first (undated last). A piece with a layer whose glaze isn't on this device
 * yet is left out, as is `excludePieceId`. `views` must already be live-only.
 */
export function buildPastPieces(
  views: PieceView[],
  glazeApps: GlazeApplication[],
  glazes: Glaze[],
  excludePieceId?: string,
): PastPiece[] {
  const liveApps = glazeApps.filter(notDeleted)
  const byId = new Map(glazes.map((g) => [g.id, g]))

  const found: { past: PastPiece; fired: StageEntry }[] = []
  for (const view of views) {
    if (view.piece.id === excludePieceId) continue
    const fired = latestEntry(
      view.entries.filter((e) => e.photoId),
      'fired',
    )
    if (!fired?.photoId) continue
    const glazed = glazedStepWithGlazes(view.entries, liveApps)
    if (!glazed) continue
    const apps = liveApps
      .filter((a) => a.entryId === glazed.id)
      .sort((a, b) => a.order - b.order)
    if (!apps.every((a) => byId.has(a.glazeId))) continue
    const layers = apps.map((a): PastLayer => {
      const g = byId.get(a.glazeId) as Glaze
      const layer: PastLayer = {
        glazeId: g.id,
        name: g.name,
        color: g.color,
        live: !g.deletedAt,
        ...layerDetails(a),
      }
      if (g.swatchPhotoId) layer.swatchPhotoId = g.swatchPhotoId
      return layer
    })
    found.push({
      fired,
      past: {
        pieceId: view.piece.id,
        name: displayName(view.piece),
        photoId: fired.photoId,
        firedDate: fired.date,
        layers,
        label: layers.map((l) => l.name).join(' over '),
      },
    })
  }
  found.sort((a, b) => compareEntries(b.fired, a.fired))
  return found.map((f) => f.past)
}

/** Each live glaze on these pieces once, alphabetical. */
export function pastChips(pieces: PastPiece[]): PastChip[] {
  const byId = new Map<string, PastChip>()
  for (const p of pieces) {
    for (const l of p.layers) {
      if (!l.live || byId.has(l.glazeId)) continue
      const chip: PastChip = {
        glazeId: l.glazeId,
        name: l.name,
        color: l.color,
      }
      if (l.swatchPhotoId) chip.swatchPhotoId = l.swatchPhotoId
      byId.set(l.glazeId, chip)
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

/** Pieces that used every one of `glazeIds`, in any layer. None given keeps all. */
export function filterPastPieces(
  pieces: PastPiece[],
  glazeIds: string[],
): PastPiece[] {
  return pieces.filter((p) =>
    glazeIds.every((id) => p.layers.some((l) => l.glazeId === id)),
  )
}

const joinNames = (names: string[]): string =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** "3 pieces with Celadon", or "No pieces with both Celadon and Chun". */
export function countLine(n: number, names: string[]): string {
  if (n === 0) {
    return `No pieces with ${names.length === 2 ? 'both ' : ''}${joinNames(names)}`
  }
  return `${n} ${n === 1 ? 'piece' : 'pieces'} with ${joinNames(names)}`
}

const sameYear = (d: Date, now: Date) => d.getFullYear() === now.getFullYear()

/** "Oct", or "Oct 2025" when not the current year. */
export function monthLabel(
  iso: string | undefined,
  now = new Date(),
): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    ...(sameYear(d, now) ? {} : { year: 'numeric' }),
  })
}

/** "Fired Oct 22", or "Fired Oct 22, 2025" when not the current year. */
export function firedLabel(
  iso: string | undefined,
  now = new Date(),
): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear(d, now) ? {} : { year: 'numeric' }),
  })
  return `Fired ${date}`
}

/**
 * The piece's recipe as glaze rows. A deleted glaze goes in by name only, so
 * saving adds it to the library again, as typing the name would.
 */
export function rowsFromPastPiece(piece: PastPiece): GlazeRow[] {
  return piece.layers.map((l) => ({
    key: crypto.randomUUID(),
    ...(l.live ? { glazeId: l.glazeId } : {}),
    name: l.name,
    ...layerDetails(l),
  }))
}

/**
 * `buildPastPieces` over live pieces, keeping only photos whose bytes this
 * device holds. `undefined` until the first read resolves.
 */
export function usePastPieces(
  excludePieceId?: string,
): PastPiece[] | undefined {
  return useLiveQuery(async () => {
    const [pieces, entries, glazeApps, glazes, clays] = await Promise.all([
      db.pieces.toArray(),
      db.entries.toArray(),
      db.glazeApps.toArray(),
      db.glazes.toArray(),
      db.clays.toArray(),
    ])
    const views = buildPieceViews(pieces, entries, glazeApps, glazes, clays)
    const past = buildPastPieces(views, glazeApps, glazes, excludePieceId)
    const held = new Set(await pickablePhotoIds(past.map((p) => p.photoId)))
    return past.filter((p) => held.has(p.photoId))
  }, [excludePieceId])
}
