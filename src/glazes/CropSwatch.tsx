import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useModal } from '../components/useModal'
import { usePhotoUrl } from '../components/usePhotoUrl'
import { SAVE_ERROR, useToast } from '../components/useToast'
import { makeSwatch, type SwatchImage } from '../photos/swatchImage'
import { type CropView, pan, sourceSquare, startView, zoomTo } from './cropView'

interface Props {
  source: Blob
  /** The source photo's size in pixels. */
  width: number
  height: number
  onUse: (image: SwatchImage) => void
  onCancel: () => void
}

/** How much of the content column the square frame takes. */
const FRAME_SHARE = 0.8

type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Full-screen crop: drag and pinch the photo under a fixed square, then use it as a swatch. */
export function CropSwatch({ source, width, height, onUse, onCancel }: Props) {
  const url = usePhotoUrl(source)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { show: showToast, toast } = useToast()
  const [view, setView] = useState<CropView>(() => startView(width, height))
  const [busy, setBusy] = useState(false)
  // Escape does nothing while the swatch is being made, like the Cancel button.
  useModal(cancelRef, () => {
    if (!busy) onCancel()
  })

  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const framePx = Math.min(area.w * FRAME_SHARE, area.h)

  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef({ distance: 0, zoom: 1 })
  const latestZoom = useRef(view.zoom)
  latestZoom.current = view.zoom

  // A pinch measures from the moment the second finger lands (or one lifts).
  const resetPinch = () => {
    const [a, b] = [...pointers.current.values()]
    pinch.current = {
      distance: a && b ? distance(a, b) : 0,
      zoom: latestZoom.current,
    }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    resetPinch()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId)
    if (!last || framePx <= 0) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)
    if (pointers.current.size === 1) {
      setView((v) =>
        pan(v, next.x - last.x, next.y - last.y, framePx, width, height),
      )
    } else if (pointers.current.size === 2 && pinch.current.distance > 0) {
      const [a, b] = [...pointers.current.values()]
      const zoom =
        pinch.current.zoom * (distance(a, b) / pinch.current.distance)
      setView((v) => zoomTo(v, zoom, width, height))
    }
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    resetPinch()
  }

  // Trackpad pinch and mouse wheels send wheel events. Attached by hand so it can be non-passive.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) =>
        zoomTo(v, v.zoom * Math.exp(-e.deltaY / 300), width, height),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [width, height])

  const use = async () => {
    setBusy(true)
    try {
      onUse(await makeSwatch(source, sourceSquare(view, width, height)))
    } catch {
      showToast(SAVE_ERROR)
      setBusy(false)
    }
  }

  // The photo is drawn at source size, then scaled and moved so the square sits under the frame.
  const square = sourceSquare(view, width, height)
  const scale = framePx > 0 ? framePx / square.size : 1
  const tx = area.w / 2 - view.cx * scale
  const ty = area.h / 2 - view.cy * scale

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop swatch"
      className="fixed inset-0 z-[60] bg-camera text-white"
    >
      <div className="mx-auto flex h-full max-w-[430px] flex-col pt-14 pb-8">
        <div className="flex items-center justify-between px-5 pb-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 rounded-[22px] bg-white/12 px-4 text-[15px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={use}
            disabled={busy}
            className="h-11 rounded-[22px] bg-white px-4 text-[15px] font-semibold text-camera disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Use swatch'}
          </button>
        </div>
        <div
          ref={areaRef}
          className="relative flex-1 touch-none overflow-hidden select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
              style={{
                width,
                height,
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              }}
            />
          ) : null}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white shadow-[0_0_0_100vmax_rgba(0,0,0,0.6)]"
            style={{ width: framePx, height: framePx }}
          />
        </div>
        <p className="px-5 pt-4 text-center text-[15px] text-white/80">
          Drag and pinch so the square holds only glaze
        </p>
      </div>
      {toast}
    </div>
  )
}
