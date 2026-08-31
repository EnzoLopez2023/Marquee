import {
  isFilesystemPathField,
  redactAbsoluteFilesystemString,
} from '../sonarr/sanitize.js'

const FILE_FIELDS = new Set(['file'])
const PLEX_ARTWORK_PATHS = [
  /^\/library\/metadata\/[1-9]\d*\/(?:thumb|art)(?:\/[1-9]\d*)?$/,
  /^\/library\/collections\/[1-9]\d*\/(?:thumb|art)(?:\/[1-9]\d*)?$/,
  /^\/playlists\/[1-9]\d*\/composite(?:\/[1-9]\d*)?$/,
]
const isPlexDirectoryCollection = (key: string, value: unknown) => (
  key === 'Directory' && Array.isArray(value)
)

export function isPlexArtworkPath(value: string) {
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.includes('..')
    || value.includes('?')
    || value.includes('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) return false
  return PLEX_ARTWORK_PATHS.some((pattern) => pattern.test(value))
}

export function sanitizeMediaPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMediaPaths)
  if (typeof value === 'string') {
    return isPlexArtworkPath(value) ? value : redactAbsoluteFilesystemString(value)
  }
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
