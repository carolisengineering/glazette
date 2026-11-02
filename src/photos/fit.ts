/** Scale (w, h) so the long edge is at most `max`, keeping aspect ratio. Never upscales. */
export function fitWithin(
  w: number,
  h: number,
  max: number,
): { w: number; h: number } {
  const long = Math.max(w, h)
  if (long <= max) return { w, h }
  const scale = max / long
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  }
}
