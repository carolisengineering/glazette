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

const METHOD_TEXT: Record<NonNullable<GlazeApplication['method']>, string> = {
  dip: 'dipped',
  brush: 'brushed',
  pour: 'poured',
  spray: 'sprayed',
}

/**
 * "2 dips · thin at rim": dips, method and note joined with middle dots,
 * leaving out what's missing. A dip count already says dipped.
 */
export function layerDetailText(layer: LayerDetails): string {
  const parts: string[] = []
  if (layer.dips != null)
    parts.push(`${layer.dips} ${layer.dips === 1 ? 'dip' : 'dips'}`)
  if (layer.method && !(layer.method === 'dip' && layer.dips != null))
    parts.push(METHOD_TEXT[layer.method])
  if (layer.note) parts.push(layer.note)
  return parts.join(' · ')
}
