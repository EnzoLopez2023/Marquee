import {
  isFilesystemPathField,
  redactAbsoluteFilesystemString,
} from '../sonarr/sanitize.js'

const FILE_FIELDS = new Set(['file'])

export function sanitizeMediaPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMediaPaths)
  if (typeof value === 'string') return redactAbsoluteFilesystemString(value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !FILE_FIELDS.has(key) && !isFilesystemPathField(key))
      .map(([key, nested]) => [key, sanitizeMediaPaths(nested)]),
  )
}
