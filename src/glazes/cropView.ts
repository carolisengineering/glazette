import type { SourceSquare } from '../photos/swatchImage'

/**
 * Which part of the photo the crop square shows. `zoom` 1 means the photo's
 * short side fills the square; `cx` and `cy` are the square's center in source pixels.
 */
export interface CropView {
  zoom: number
  cx: number
  cy: number
}

export const MAX_ZOOM = 8

function clampView(view: CropView, w: number, h: number): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom))
  const half = Math.min(w, h) / zoom / 2
  return {
    zoom,
    cx: Math.min(w - half, Math.max(half, view.cx)),
    cy: Math.min(h - half, Math.max(half, view.cy)),
  }
}

/** The first view: the short side fills the square, centered. */
export function startView(w: number, h: number): CropView {
  return { zoom: 1, cx: w / 2, cy: h / 2 }
}

/** The square to cut from the source photo for this view. */
export function sourceSquare(
  view: CropView,
  w: number,
  h: number,
): SourceSquare {
  const size = Math.min(w, h) / view.zoom
  return { sx: view.cx - size / 2, sy: view.cy - size / 2, size }
}

/**
 * Drag the photo by `dx`, `dy` screen pixels while the square is `framePx` wide
 * on screen. The photo follows the finger and never leaves the square.
 */
export function pan(
  view: CropView,
  dx: number,
  dy: number,
  framePx: number,
  w: number,
  h: number,
): CropView {
  const perPx = Math.min(w, h) / view.zoom / framePx
  return clampView(
    { ...view, cx: view.cx - dx * perPx, cy: view.cy - dy * perPx },
    w,
    h,
  )
}

/** Set the zoom, within 1 to MAX_ZOOM, keeping the square inside the photo. */
export function zoomTo(
  view: CropView,
  zoom: number,
  w: number,
  h: number,
): CropView {
  return clampView({ ...view, zoom }, w, h)
}
