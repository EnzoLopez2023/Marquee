import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertPlexTlsConfiguration,
  certificateSha256Matches,
  plexTlsMode,
} from '../../server/domain/media/plexTls.js'

describe('Plex TLS policy', () => {
  it('uses verified TLS unless insecure compatibility is explicit', () => {
    expect(plexTlsMode('https://plex.example', {
      insecure: false, caFile: '', certificateSha256: '',
    })).toEqual({ mode: 'verified', degraded: false })
    expect(plexTlsMode('https://plex.example', {
      insecure: false, caFile: '/private/plex-ca.pem', certificateSha256: '',
    })).toEqual({ mode: 'private-ca', degraded: false })
    expect(plexTlsMode('https://plex.example', {
      insecure: true, caFile: '', certificateSha256: '',
    })).toEqual({ mode: 'insecure', degraded: true })
  })

  it('matches the configured SHA-256 certificate pin exactly', () => {
    const raw = Buffer.from('certificate-der')
    const pin = createHash('sha256').update(raw).digest('hex')
    expect(certificateSha256Matches(raw, pin)).toBe(true)
    expect(certificateSha256Matches(Buffer.from('other'), pin)).toBe(false)
  })

  it('contains no implicit blanket TLS bypass', () => {
    const client = readFileSync('server/clients/plex.ts', 'utf8')
    expect(client).toContain('rejectUnauthorized: !config.plex.tls.insecure')
    expect(client).not.toContain('rejectUnauthorized: false')
  })

  it('requires explicit insecure mode for HTTP in every environment', () => {
    expect(() => assertPlexTlsConfiguration('http://plex.internal:32400', {
      insecure: false, caFile: '', certificateSha256: '',
    })).toThrow('explicit PLEX_TLS_INSECURE=true')
    expect(() => assertPlexTlsConfiguration('http://plex.internal:32400', {
      insecure: true, caFile: '', certificateSha256: '',
    })).not.toThrow()
    expect(() => assertPlexTlsConfiguration('ftp://plex.internal', {
      insecure: true, caFile: '', certificateSha256: '',
    })).toThrow('HTTP or HTTPS')
  })
})
