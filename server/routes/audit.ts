import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/index.js'

export function createAuditRouter(repositories: Repositories) {
  const router = Router()
  router.post('/api/audit/events', async (req, res) => {
    if (!Array.isArray(req.body?.events) || req.body.events.length > 200) {
      return res.status(400).json({ error: { code: 'INVALID_TELEMETRY_BATCH' } })
    }
    const events = req.body.events
    const ip = (req.get('x-forwarded-for') || '').split(',')[0]?.trim() || req.ip || null
    const kinds = new Set(['navigation', 'ui_interaction', 'client_error'])
    const views = new Set([
      'plex-library', 'plex-command-center', 'sonarr-dashboard', 'admin', 'settings',
    ])
    for (const event of events) {
      const kind = typeof event?.kind === 'string' ? event.kind : ''
      const view = event?.view == null ? null : String(event.view)
      const detail = event?.detail == null ? null : String(event.detail)
      if (
        !kinds.has(kind)
        || (view !== null && !views.has(view))
        || (detail !== null && detail.length > 200)
        || !req.identity
      ) {
        return res.status(400).json({ error: { code: 'INVALID_CLIENT_TELEMETRY' } })
      }
    }
    for (const event of events) {
      await repositories.audit.appendClientTelemetry(
        event.kind,
        event.view ?? null,
        event.detail ?? null,
        req.identity!,
        ip,
      )
    }
    return res.json({ ok: true, stored: events.length, authoritative: false })
  })
  return router
}
