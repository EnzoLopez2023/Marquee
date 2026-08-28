import { createHash, timingSafeEqual } from 'node:crypto'

export interface PlexTlsSettings {
  insecure: boolean
  caFile: string
  certificateSha256: string
}

export function certificateSha256Matches(rawCertificate: Buffer, expectedHex: string) {
  const actual = createHash('sha256').update(rawCertificate).digest()
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function plexTlsMode(baseUrl: string, settings: PlexTlsSettings) {
  const protocol = new URL(baseUrl).protocol
  if (protocol !== 'https:' || settings.insecure) {
    return { mode: 'insecure' as const, degraded: true }
  }
  if (settings.caFile && settings.certificateSha256) {
    return { mode: 'private-ca+pinned' as const, degraded: false }
  }
  if (settings.caFile) return { mode: 'private-ca' as const, degraded: false }
  if (settings.certificateSha256) return { mode: 'verified+pinned' as const, degraded: false }
  return { mode: 'verified' as const, degraded: false }
}

export function assertPlexTlsConfiguration(baseUrl: string, settings: PlexTlsSettings) {
  const protocol = new URL(baseUrl).protocol
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error('PLEX_BASE_URL must use HTTP or HTTPS')
  }
  if (protocol !== 'https:' && !settings.insecure) {
    throw new Error('Non-HTTPS PLEX_BASE_URL requires explicit PLEX_TLS_INSECURE=true')
  }
  if (settings.certificateSha256 && !/^[a-f0-9]{64}$/.test(settings.certificateSha256)) {
    throw new Error('PLEX_TLS_CERT_SHA256 must be a SHA-256 hex fingerprint')
  }
  if (settings.insecure && (settings.caFile || settings.certificateSha256)) {
    throw new Error('PLEX_TLS_INSECURE cannot be combined with CA or certificate pinning')
  }
}
