const CANONICAL_PLEX_ID = /^[1-9]\d*$/

export function canonicalPlexId(value: unknown): string | null {
  return typeof value === 'string' && CANONICAL_PLEX_ID.test(value) ? value : null
}

export function requireCanonicalPlexId(value: unknown, label: string): string {
  const id = canonicalPlexId(value)
  if (!id) throw new Error(`Invalid ${label}`)
  return id
}
