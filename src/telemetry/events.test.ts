import { describe, expect, it } from 'vitest'
import { STAGES } from '../db/stage'
import {
  EDIT_PARTS,
  type EventName,
  type EventProps,
  OUTCOMES,
  PUT_BACK_KINDS,
  SCREENS,
  VITAL_METRICS,
} from './events'

// One example per event; the compiler fails if an event is missing.
const EXAMPLES: { [N in EventName]: EventProps[N] } = {
  app_opened: { standalone: true, resumed: false },
  screen_viewed: { screen: 'shelf' },
  piece_logged: { has_photo: true, stage: 'thrown', ms: 1200 },
  stage_added: { stage: 'glazed', has_photo: false, ms: 800 },
  glazes_added: { layers: 2 },
  piece_edited: { part: 'notes' },
  piece_lost: { lost: true },
  piece_deleted: {},
  step_deleted: {},
  put_back: { kind: 'photo' },
  signed_in: {},
  signed_out: {},
  backup_saved: { ms: 300 },
  backup_restored: { ms: 450 },
  startup: { ms: 900, pieces: 12 },
  piece_opened: { ms: 120, has_photo: true },
  photo_processed: { ms: 600, megabytes: 1.4 },
  sync_records: { ms: 500, outcome: 'done', pushed: 3, pulled: 1 },
  sync_photos: {
    ms: 700,
    outcome: 'offline',
    uploaded: 1,
    downloaded: 0,
    bytes: 20480,
  },
  web_vital: { metric: 'LCP', value: 1800 },
  telemetry_started: { first_piece_date: '2026-03-01', pieces: 12 },
}

const ALLOWED_STRINGS = new Set<string>([
  ...STAGES,
  ...SCREENS,
  ...OUTCOMES,
  ...EDIT_PARTS,
  ...PUT_BACK_KINDS,
  ...VITAL_METRICS,
])

describe('event props privacy', () => {
  it('only carry numbers, booleans, dates or fixed strings', () => {
    for (const [name, props] of Object.entries(EXAMPLES)) {
      for (const [key, value] of Object.entries(props)) {
        const ok =
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'boolean' ||
          (typeof value === 'string' &&
            (/^\d{4}-\d{2}-\d{2}$/.test(value) || ALLOWED_STRINGS.has(value)))
        expect(ok, `${name}.${key}`).toBe(true)
      }
    }
  })
})
