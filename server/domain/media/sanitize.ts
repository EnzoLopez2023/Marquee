import {
  isFilesystemPathField,
  redactAbsoluteFilesystemString,
} from '../sonarr/sanitize.js'

const FILE_FIELDS = new Set(['file'])
const isPlexDirectoryCollection = (key: string, value: unknown) => (
  key === 'Directory' && Array.isArray(value)
)

export function sanitizeMediaPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMediaPaths)
  if (typeof value === 'string') return redactAbsoluteFilesystemString(value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, nested]) => (
        !FILE_FIELDS.has(key)
        && (!isFilesystemPathField(key) || isPlexDirectoryCollection(key, nested))
      ))
      .map(([key, nested]) => [key, sanitizeMediaPaths(nested)]),
  )
}
