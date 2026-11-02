import type { Settings } from './types'

export const DEFAULT_CLAY_NAME = 'White stoneware'

export const DEFAULT_SETTINGS: Omit<Settings, 'defaultClayId'> = {
  id: 'app',
  defaultCone: '6',
  bisqueNote: 'Cone 6',
  firedNote: 'Cone 6 oxidation',
}
