import { useLiveQuery } from 'dexie-react-hooks'
import type { GlazeRow } from '../capture/GlazeRows'
import { db } from '../db/db'
import { layerDetails } from '../db/layerDetails'
import { buildPieceViews, type PieceView } from '../db/queries'
import { nameKey } from '../db/rowChecks'
import { compareEntries, displayName, latestEntry } from '../db/stage'
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

/** A glaze to narrow the past pieces by, matched by name. */
export interface PastChip {
  /** The glaze's name as a match key (see `nameKey`). */
  key: string
  name: string
  color: string
  swatchPhotoId?: string
}

/**
 * Pieces with a fired photo and glazes on their glaze step, newest Fired step
 * first (undated last). The photo is the newest Fired photo in `held`, when
 * given. A piece with a layer whose glaze isn't on this device yet is left
 * out, as is `excludePieceId`. `views` must already be live-only.
 */
export function buildPastPieces(
  views: PieceView[],
  glazeApps: GlazeApplication[],
  glazes: Glaze[],
  excludePieceId?: string,
  held?: Set<string>,
): PastPiece[] {
  const byId = new Map(glazes.map((g) => [g.id, g]))
  const appsByStep = new Map<string, GlazeApplication[]>()
  for (const a of glazeApps) {
    if (a.deletedAt) continue
    const list = appsByStep.get(a.entryId)
    if (list) list.push(a)
    else appsByStep.set(a.entryId, [a])
  }

  const found: { past: PastPiece; fired: StageEntry }[] = []
  for (const view of views) {
    if (view.piece.id === excludePieceId) continue
    const fired = latestEntry(
      view.entries.filter((e) => e.photoId && (!held || held.has(e.photoId))),
      'fired',
    )
    if (!fired?.photoId) continue
    // The glaze step is the one with layers, when any step has them.
    const apps = [
      ...((view.glazeStepId && appsByStep.get(view.glazeStepId)) || []),
    ].sort((a, b) => a.order - b.order)
    if (apps.length === 0) continue
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

/** Each live glaze name on these pieces once, alphabetical. */
export function pastChips(pieces: PastPiece[]): PastChip[] {
  const byKey = new Map<string, PastChip>()
  for (const p of pieces) {
    for (const l of p.layers) {
      const key = nameKey(l.name)
      if (!l.live || byKey.has(key)) continue
      const chip: PastChip = { key, name: l.name, color: l.color }
      if (l.swatchPhotoId) chip.swatchPhotoId = l.swatchPhotoId
      byKey.set(key, chip)
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

/**
 * Pieces that used every one of these glaze names (chip keys), in any layer.
 * None given keeps all. Matching by name means a glaze deleted and added again
 * under the same name still finds the pieces that wore the old one.
 */
export function filterPastPieces(
  pieces: PastPiece[],
  keys: string[],
): PastPiece[] {
  return pieces.filter((p) => {
    const has = new Set(p.layers.map((l) => nameKey(l.name)))
    return keys.every((k) => has.has(k))
  })
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
 * `buildPastPieces` over live pieces, using only fired photos whose bytes this
 * device holds. `undefined` until the first read resolves.
 */
export function usePastPieces(
  excludePieceId?: string,
): PastPiece[] | undefined {
  return useLiveQuery(async () => {
    const [pieces, entries, glazeApps, glazes] = await Promise.all([
      db.pieces.toArray(),
      db.entries.toArray(),
      db.glazeApps.toArray(),
      db.glazes.toArray(),
    ])
    const views = buildPieceViews(pieces, entries, glazeApps, glazes, [])
    const firedPhotos = views.flatMap((v) =>
      v.entries.flatMap((e) =>
        e.stage === 'fired' && e.photoId ? [e.photoId] : [],
      ),
    )
    const held = new Set(await pickablePhotoIds(firedPhotos))
    return buildPastPieces(views, glazeApps, glazes, excludePieceId, held)
  }, [excludePieceId])
}
