import type { GlazeApplication } from './types'

export interface LayerDetails {
  dips?: number
  method?: GlazeApplication['method']
  note?: string
}

/**
 * Just the dips, method and note a layer has, with no keys for missing ones, so
 * stored rows and views stay clean. A null (what JSON makes of an infinite
 * number) counts as missing.
 */
export function layerDetails(src: LayerDetails): LayerDetails {
  const out: LayerDetails = {}
  if (src.dips != null) out.dips = src.dips
  if (src.method != null) out.method = src.method
  if (src.note != null) out.note = src.note
  return out
}
