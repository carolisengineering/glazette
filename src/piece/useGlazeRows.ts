import Dexie from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import type { GlazeRow } from '../capture/GlazeRows'
import { loadGlazeRows, resolveGlazes } from '../capture/resolveGlazes'
import { db } from '../db/db'
import { setStepGlazes } from '../db/stepEdits'

/** What a row saves as, ignoring its key, blank rows and spacing. */
const saved = (rows: GlazeRow[] | undefined): string =>
  JSON.stringify(
    (rows ?? [])
      .filter((r) => r.glazeId || r.name.trim())
      .map((r) => [
        r.glazeId ?? r.name.trim().toLowerCase(),
        r.dips,
        r.method,
        r.note?.trim() || undefined,
      ]),
  )

/**
 * A glaze step's layers as editable rows, for Edit piece and the step sheet.
 * `rows` stays undefined until they load (and if loading fails, so the section
 * stays hidden). `changed` says whether the user's edits would save anything
 * different from what loaded; when they wouldn't, Save must leave the layers
 * alone, since they may have synced in from another device since.
 */
export function useGlazeRows(stepId: string | undefined): {
  rows: GlazeRow[] | undefined
  setRows: (rows: GlazeRow[]) => void
  changed: boolean
} {
  const [loaded, setLoaded] = useState<GlazeRow[]>()
  const [rows, setRows] = useState<GlazeRow[]>()

  useEffect(() => {
    if (!stepId) return
    let active = true
    loadGlazeRows(stepId).then(
      (next) => {
        if (!active) return
        setLoaded(next)
        setRows(next)
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [stepId])

  const changed = useMemo(
    () => rows !== undefined && saved(rows) !== saved(loaded),
    [rows, loaded],
  )
  return { rows, setRows, changed }
}

/**
 * Saves edited rows as a Glazed step's layers: matches or creates library
 * glazes, then makes the step's layers equal the rows. Returns whether any
 * layer changed. Runs only inside the caller's transaction (covering pieces,
 * entries, glazeApps, glazes and settings), so a failed save leaves no new
 * library glaze behind.
 */
export async function saveGlazeRows(
  stepId: string,
  rows: GlazeRow[],
): Promise<boolean> {
  if (!Dexie.currentTransaction) {
    throw new Error('saveGlazeRows must run inside a transaction')
  }
  const cone = (await db.settings.get('app'))?.defaultCone ?? '6'
  return setStepGlazes(stepId, await resolveGlazes(rows, cone))
}
