import { useLiveQuery } from 'dexie-react-hooks'
import type { CSSProperties } from 'react'
import { db } from '../db/db'
import { notDeleted, type PieceView, usePiecesQuery } from '../db/queries'
import { latestEntry } from '../db/stage'
import type { Glaze, GlazeApplication } from '../db/types'

export interface GlazeView {
  glaze: Glaze
  /** Live pieces (lost ones included) whose latest Glazed entry uses this glaze. */
  pieceIds: string[]
  /** Photo of the newest Fired entry with a photo among those pieces. */
  swatchPhotoId?: string
}

/**
 * Live glazes, alphabetical, each with the pieces that currently wear it.
 * `pieceViews` must already be live-only (see `buildPieceViews`).
 */
export function buildGlazeViews(
  pieceViews: PieceView[],
  glazeApps: GlazeApplication[],
  glazes: Glaze[],
): GlazeView[] {
  const used = new Map<string, PieceView[]>()
  for (const view of pieceViews) {
    const glazed = latestEntry(view.entries, 'glazed')
    if (!glazed) continue
    const ids = new Set(
      glazeApps.filter((a) => a.entryId === glazed.id).map((a) => a.glazeId),
    )
    for (const id of ids) {
      const list = used.get(id)
      if (list) list.push(view)
      else used.set(id, [view])
    }
  }

  return glazes
    .filter(notDeleted)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
    .map((glaze) => {
      const views = used.get(glaze.id) ?? []
      let swatch: { photoId: string; date: string } | undefined
      for (const view of views) {
        const fired = latestEntry(
          view.entries.filter((e) => e.photoId),
          'fired',
        )
        if (fired?.photoId && (!swatch || fired.date > swatch.date)) {
          swatch = { photoId: fired.photoId, date: fired.date }
        }
      }
      return {
        glaze,
        pieceIds: views.map((v) => v.piece.id),
        swatchPhotoId: swatch?.photoId,
      }
    })
}

/** `undefined` until the first read resolves. */
export function useGlazeViews(): GlazeView[] | undefined {
  const pieceViews = usePiecesQuery()
  const rows = useLiveQuery(async () => {
    const [glazeApps, glazes] = await Promise.all([
      db.glazeApps.toArray(),
      db.glazes.toArray(),
    ])
    return { glazeApps, glazes }
  }, [])
  if (!pieceViews || !rows) return undefined
  return buildGlazeViews(pieceViews, rows.glazeApps, rows.glazes)
}

/**
 * The automatic center-crop: the photo fills a square tile, trimmed evenly
 * from the long edges. Any aspect ratio works, so the size isn't needed.
 */
export function centerCropStyle(
  _width: number,
  _height: number,
): CSSProperties {
  return {
    objectFit: 'cover',
    objectPosition: 'center',
    width: '100%',
    height: '100%',
  }
}
