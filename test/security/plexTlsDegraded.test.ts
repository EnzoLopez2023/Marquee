import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.PLEX_TLS_INSECURE = 'true'
})

import { createApp } from '../../server/app.js'
import { publicConfigSummary } from '../../server/config.js'
import { temporaryDatabase } from '../helpers.js'

describe('Plex insecure compatibility visibility', () => {
  it('surfaces degraded health and writes an authoritative audit event', async () => {
    const handle = temporaryDatabase()
    try {
      createApp(handle)
      await Promise.resolve()
      expect(publicConfigSummary().transport.plex).toEqual({
        mode: 'insecure',
        degraded: true,
      })
      expect(handle.db.prepare(
        "SELECT status FROM provider_health WHERE provider = 'plex'",
      ).get()).toMatchObject({ status: 'error' })
      expect(handle.db.prepare(`
        SELECT authoritative, source FROM app_audit_log
        WHERE action = 'Plex TLS insecure compatibility enabled'
      `).get()).toMatchObject({ authoritative: 1, source: 'server' })
    } finally {
      handle.cleanup()
    }
  })
})
