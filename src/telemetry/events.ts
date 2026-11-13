import type { Stage } from '../db/types'
import type { SyncOutcome } from '../sync/engine'

// Every value sent is a number, a boolean, a YYYY-MM-DD date, or one of these
// fixed strings. The lists are exported so the privacy test can check against them.
export const SCREENS = [
  'shelf',
  'piece',
  'glazes',
  'capture',
  'account',
  'backup',
] as const
export type Screen = (typeof SCREENS)[number]

export const OUTCOMES = [
  'done',
  'offline',
  'signed-out',
  'error',
] as const satisfies readonly SyncOutcome[]
export type Outcome = (typeof OUTCOMES)[number]
// Fails to compile when a SyncOutcome is missing from the list above.
const _everyOutcomeListed: [Exclude<SyncOutcome, Outcome>] extends [never]
  ? true
  : never = true
void _everyOutcomeListed

export const EDIT_PARTS = [
  'details',
  'notes',
  'step',
  'glazes',
  'photo',
] as const
export const PUT_BACK_KINDS = ['piece', 'photo'] as const
export const VITAL_METRICS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const

export type EventProps = {
  app_opened: { standalone: boolean; resumed: boolean }
  screen_viewed: { screen: Screen }
  piece_logged: { has_photo: boolean; stage: Stage; ms: number }
  stage_added: { stage: Stage; has_photo: boolean; ms: number }
  glazes_added: { layers: number }
  piece_edited: { part: (typeof EDIT_PARTS)[number] }
  piece_lost: { lost: boolean }
  piece_deleted: Record<string, never>
  step_deleted: Record<string, never>
  put_back: { kind: (typeof PUT_BACK_KINDS)[number] }
  signed_in: Record<string, never>
  signed_out: Record<string, never>
  backup_saved: { ms: number }
  backup_restored: { ms: number }
  startup: { ms: number; pieces: number }
  piece_opened: { ms: number; has_photo: boolean }
  photo_processed: { ms: number; megabytes: number }
  sync_records: {
    ms: number
    outcome: Outcome
    pushed: number
    pulled: number
  }
  sync_photos: {
    ms: number
    outcome: Outcome
    uploaded: number
    downloaded: number
    bytes: number
  }
  web_vital: { metric: (typeof VITAL_METRICS)[number]; value: number }
  telemetry_started: { first_piece_date?: string; pieces: number }
}

export type EventName = keyof EventProps

/** Properties attached to every event, set once rather than per event. */
export type SuperProps = { app_version: string; after_update?: true }
