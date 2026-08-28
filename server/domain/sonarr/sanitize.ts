const PATH_FIELD = /^(?:appdata|.*(?:paths?|folders?|directory|directories))$/i
const WINDOWS_ABSOLUTE = /(?:(?:^|[^a-z0-9_])[a-z]:[\\/]|\\\\[^\\/\s]+[\\/])/i
const POSIX_ABSOLUTE = /\/[^\s"'<>?#/]+(?:\/[^\s"'<>?#/]+)*/g
const WEB_ROUTE_PREFIXES = ['/api/', '/signalr/']
const WEB_ROUTE_EXACT = new Set(['/api', '/signalr', '/ping', '/version.json', '/runtime-config.js'])

const containsPosixFilesystemPath = (value: string) => {
  for (const match of value.matchAll(POSIX_ABSOLUTE)) {
    const candidate = match[0]
    const prefix = value.slice(0, match.index ?? 0)
    if (/[a-z][a-z0-9+.-]*:\/$/i.test(prefix)) continue
    if (
      candidate
      && !WEB_ROUTE_EXACT.has(candidate)
      && !WEB_ROUTE_PREFIXES.some((prefix) => candidate.startsWith(prefix))
    ) {
      return true
    }
  }
  return false
}

export function redactAbsoluteFilesystemString(value: string) {
  return WINDOWS_ABSOLUTE.test(value) || containsPosixFilesystemPath(value)
    ? '[redacted filesystem path]'
    : value
}

export const isFilesystemPathField = (key: string) => PATH_FIELD.test(key)

export function sanitizeSonarrData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSonarrData)
  if (typeof value === 'string') return redactAbsoluteFilesystemString(value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isFilesystemPathField(key))
      .map(([key, nested]) => [key, sanitizeSonarrData(nested)]),
  )
}
