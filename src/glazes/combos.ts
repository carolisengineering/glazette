import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/db'
import {
  buildPieceViews,
  notDeleted,
  type PieceView,
  usePiecesQuery,
} from '../db/queries'
import { isValidStack } from '../db/rowChecks'
import { compareEntries, glazedStepWithGlazes } from '../db/stage'
import type { Combo, Glaze, GlazeApplication, StageEntry } from '../db/types'
import { pickablePhotoIds } from './PiecePhotoGrid'

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
 * deleted. Their `pieces` are left empty; `buildComboViews` fills them.
 */
export function shownComboViews(combos: Combo[], glazes: Glaze[]): ComboView[] {
  const byId = new Map(glazes.filter(notDeleted).map((g) => [g.id, g]))
  const views: ComboView[] = []
  for (const combo of combos.filter(notDeleted)) {
    const layers = combo.layers.map((id) => byId.get(id))
    if (layers.some((g) => !g)) continue
    const found = layers as Glaze[]
    views.push({
      combo,
      layers: found,
      name: found.map((g) => g.name).join(' over '),
      label: {
        top: found[0].name,
        ...(found.length === 3 ? { over: `over ${found[1].name}` } : {}),
      },
      pieces: [],
    })
  }
  return views
}

/**
 * A piece's current stack: the glaze ids on its latest Glazed step with live
 * layers, top first. Undefined when it has no such step. `liveApps` must
 * already be live-only. The "wore it" count and From a piece both use this,
 * so they agree on what a piece wears.
 */
export function pieceStack(
  view: PieceView,
  liveApps: GlazeApplication[],
): string[] | undefined {
  const glazed = glazedStepWithGlazes(view.entries, liveApps)
  if (!glazed) return undefined
  return liveApps
    .filter((a) => a.entryId === glazed.id)
    .sort((a, b) => a.order - b.order)
    .map((a) => a.glazeId)
}

/**
 * The combos to show (see `shownComboViews`), each with the pieces wearing
 * it. `pieceViews` must already be live-only (see `buildPieceViews`).
 */
export function buildComboViews(
  combos: Combo[],
  glazes: Glaze[],
  pieceViews: PieceView[],
  glazeApps: GlazeApplication[],
): ComboView[] {
  const liveApps = glazeApps.filter(notDeleted)

  // Each piece's current layers, bottom of the list last.
  const stacks = pieceViews.flatMap((view) => {
    const ids = pieceStack(view, liveApps)
    return ids ? [{ view, key: ids.join('|') }] : []
  })

  return shownComboViews(combos, glazes).map((view) => {
    const key = view.combo.layers.join('|')
    return {
      ...view,
      pieces: stacks.filter((s) => s.key === key).map((s) => s.view),
    }
  })
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

/**
 * Built once per change to the rows read, not on every render. `undefined`
 * until the first read resolves.
 */
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
  return useMemo(
    () =>
      pieceViews && rows
        ? buildComboViews(rows.combos, rows.glazes, pieceViews, rows.glazeApps)
        : undefined,
    [pieceViews, rows],
  )
}

/**
 * The combos to show, with `pieces` left empty, for pickers that don't need
 * piece counts. Reads only combos and glazes, and builds the views only when
 * those change. `undefined` until the first read resolves.
 */
export function useShownCombos(): ComboView[] | undefined {
  return useLiveQuery(async () => {
    const [combos, glazes] = await Promise.all([
      db.combos.toArray(),
      db.glazes.toArray(),
    ])
    return shownComboViews(combos, glazes)
  }, [])
}

/**
 * Shown combos (see `shownComboViews`) with this glaze in any layer: the ones
 * deleting the glaze would hide. A combo another deleted glaze already hides
 * isn't counted.
 */
export function comboCountWith(
  glazeId: string,
  combos: Combo[],
  glazes: Glaze[],
): number {
  return shownComboViews(combos, glazes).filter((v) =>
    v.combo.layers.includes(glazeId),
  ).length
}

export interface ComboPhotoChoice {
  photoId: string
  /** The piece's glaze ids, top first. */
  layers: string[]
  /** Layer names joined with " over ", top first. */
  name: string
}

/**
 * Fired photos of pieces whose glaze step's live layers make a valid stack of
 * live glazes, newest step first, each photo once. With `only`, just the
 * pieces wearing exactly that stack. `pieceViews` must already be live-only.
 */
export function comboPhotoChoices(
  pieceViews: PieceView[],
  glazeApps: GlazeApplication[],
  glazes: Glaze[],
  only?: string[],
): ComboPhotoChoice[] {
  const liveApps = glazeApps.filter(notDeleted)
  const byId = new Map(glazes.filter(notDeleted).map((g) => [g.id, g]))
  const onlyKey = only?.join('|')

  const found: { entry: StageEntry; layers: string[]; name: string }[] = []
  for (const view of pieceViews) {
    const layers = pieceStack(view, liveApps)
    if (!layers) continue
    if (!isValidStack(layers) || !layers.every((id) => byId.has(id))) continue
    if (onlyKey !== undefined && layers.join('|') !== onlyKey) continue
    const name = layers.map((id) => byId.get(id)?.name).join(' over ')
    for (const entry of view.entries) {
      if (entry.stage === 'fired' && !entry.deletedAt && entry.photoId) {
        found.push({ entry, layers, name })
      }
    }
  }

  found.sort((a, b) => compareEntries(b.entry, a.entry))
  const seen = new Set<string>()
  return found.flatMap(({ entry, layers, name }) => {
    const photoId = entry.photoId as string
    if (seen.has(photoId)) return []
    seen.add(photoId)
    return [{ photoId, layers, name }]
  })
}

/**
 * `comboPhotoChoices` over live pieces, keeping only photos whose bytes this
 * device holds. `undefined` until the first read resolves.
 */
export function useComboPhotoChoices(
  only?: string[],
): ComboPhotoChoice[] | undefined {
  const key = only?.join('|')
  return useLiveQuery(async () => {
    const [pieces, entries, glazeApps, glazes, clays] = await Promise.all([
      db.pieces.toArray(),
      db.entries.toArray(),
      db.glazeApps.toArray(),
      db.glazes.toArray(),
      db.clays.toArray(),
    ])
    const views = buildPieceViews(pieces, entries, glazeApps, glazes, clays)
    const choices = comboPhotoChoices(views, glazeApps, glazes, only)
    const held = new Set(await pickablePhotoIds(choices.map((c) => c.photoId)))
    return choices.filter((c) => held.has(c.photoId))
  }, [key])
}
