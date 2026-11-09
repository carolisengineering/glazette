import { PHOTO_HASH } from '../../shared/photoProtocol'
import { DEFAULT_GLAZE_COLOR } from './seed'
import { STAGES } from './stage'

// Checks for a row as it travels: in a backup or in a sync record. Unknown
// fields (and device-only ones such as dirty) are allowed.

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A plain object: not null and not an array. */
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringOrAbsent = (v: unknown) =>
  v === undefined || typeof v === 'string'

/**
 * A row is an object with a string id and the other listed string keys, and
 * `deletedAt` is a string or absent.
 */
export function isRow(
  row: unknown,
  stringKeys: string[] = [],
  extra: (row: Record<string, unknown>) => boolean = () => true,
): boolean {
  return (
    isObject(row) &&
    ['id', ...stringKeys].every((k) => typeof row[k] === 'string') &&
    isStringOrAbsent(row.deletedAt) &&
    extra(row)
  )
}

export const isPieceRow = (row: unknown) =>
  isRow(row, ['updatedAt', 'createdAt'])

export const isEntryRow = (row: unknown) =>
  isRow(
    row,
    ['pieceId'],
    (r) =>
      STAGES.includes(r.stage as never) &&
      ['photoId', 'date', 'note'].every((k) => isStringOrAbsent(r[k])),
  )

export const isLayerRow = (row: unknown) =>
  isRow(
    row,
    ['entryId', 'pieceId', 'glazeId'],
    (r) => typeof r.order === 'number',
  )

export const isGlazeRow = (row: unknown) => isRow(row, ['name'])

export const isClayRow = (row: unknown) => isRow(row, ['name'])

const isPositive = (v: unknown) => typeof v === 'number' && v > 0

/** A photo as a record: details only, so blob and thumb are absent. */
export const isPhotoRow = (row: unknown) =>
  isRow(
    row,
    ['hash', 'takenAt'],
    (r) =>
      PHOTO_HASH.test(r.hash as string) &&
      isPositive(r.width) &&
      isPositive(r.height) &&
      r.blob === undefined &&
      r.thumb === undefined &&
      isStringOrAbsent(r.updatedAt) &&
      isStringOrAbsent(r.mergedInto),
  )

export function isSettingsRow(row: unknown): boolean {
  return (
    isObject(row) &&
    ['defaultCone', 'bisqueNote', 'firedNote'].every(
      (k) => typeof row[k] === 'string',
    ) &&
    ['studioName', 'defaultClayId', 'lastBackupAt'].every((k) =>
      isStringOrAbsent(row[k]),
    )
  )
}

/** The glaze with a usable swatch color: anything but #rrggbb gets the default. */
export function withValidColor<T extends { color?: unknown }>(glaze: T): T {
  return typeof glaze.color === 'string' && HEX_COLOR.test(glaze.color)
    ? glaze
    : { ...glaze, color: DEFAULT_GLAZE_COLOR }
}

/** How clays and glazes match by name: ignoring case and surrounding spaces. */
export const nameKey = (name: string) => name.trim().toLowerCase()
