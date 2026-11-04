import type { Settings } from './types'

export const DEFAULT_CLAY_NAME = 'White stoneware'

/** Swatch color for a glaze created without picking one. */
export const DEFAULT_GLAZE_COLOR = '#9DBBAA'

export const DEFAULT_SETTINGS: Omit<Settings, 'defaultClayId'> = {
  id: 'app',
  defaultCone: '6',
  bisqueNote: 'Cone 6',
  firedNote: 'Cone 6 oxidation',
}
