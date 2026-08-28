import type { RequestHandler } from 'express'
import type Database from 'better-sqlite3'
import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/index.js'
import type { AppRole } from '../../lib/db/repositories/identities.js'
import { config, publicConfigSummary, resolveAdminOid } from '../config.js'
import { plexJson } from '../clients/plex.js'
import { tautulliApi } from '../clients/tautulli.js'
import { sanitizeSonarrData } from '../domain/sonarr/sanitize.js'
import {
  assertAdminGrantRemains,
  LastAdminRequiredError,
} from '../domain/auth/adminRoles.js'

const roles = new Set<AppRole>(['viewer', 'duplicate_delete', 'admin'])

export function createAdminRouter(
  db: Database.Database,
  repositories: Repositories,
  requireAdmin: RequestHandler,
) {
  const router = Router()

  router.get('/api/me', async (req, res) => {
    const features = db.prepare(`
      SELECT feature, can_edit, is_hidden FROM app_feature_permissions
      WHERE tenant_id = ? AND oid = ?
    `).all(req.identity!.tenantId, req.identity!.oid)
    res.json({ identity: req.identity, roles: req.roles ?? [], features })
  })

  router.get('/api/admin/users', requireAdmin, async (_req, res) => {
    res.json({ users: await repositories.identities.list() })
  })

  router.put('/api/admin/users/:tenantId/:oid/roles', requireAdmin, async (req, res) => {
    const requested = Array.isArray(req.body?.roles) ? req.body.roles : []
    if (!requested.every((role: unknown): role is AppRole => (
      typeof role === 'string' && roles.has(role as AppRole)
    ))) {
      return res.status(400).json({ error: { code: 'INVALID_ROLES' } })
    }
    const target = {
      tenantId: String(req.params.tenantId),
      oid: String(req.params.oid),
    }
    const configuredAdmin = resolveAdminOid(
      config.entra.adminOid,
      config.entra.bootstrapAdminOid,
      false,
    )
    if (target.oid === configuredAdmin && !requested.includes('admin')) {
      return res.status(409).json({
        error: { code: 'CONFIGURED_ADMIN_REQUIRED' },
      })
    }
    const exists = db.prepare(
      'SELECT 1 FROM app_identities WHERE tenant_id = ? AND oid = ?',
    ).get(target.tenantId, target.oid)
    if (!exists) return res.status(404).json({ error: { code: 'IDENTITY_NOT_FOUND' } })
    try {
      db.transaction(() => {
        repositories.identities.replaceRolesInTransaction(target, requested, req.identity!)
        assertAdminGrantRemains(db)
        repositories.audit.appendAuthoritativeInTransaction({
          category: 'change',
          action: 'Updated Marquee roles',
          method: 'PUT',
          path: req.path,
          status: 200,
          detail: `${target.tenantId}/${target.oid}: ${requested.join(', ')}`,
        }, req.identity!, req.ip ?? null)
      })()
      return res.json({ ok: true, roles: requested })
    } catch (error) {
      if (error instanceof LastAdminRequiredError) {
        return res.status(409).json({ error: { code: error.code } })
      }
      console.error('Atomic admin role update failed:', error)
      return res.status(500).json({ error: { code: 'ADMIN_ROLE_UPDATE_FAILED' } })
    }
  })

  router.get('/api/admin/audit', requireAdmin, async (req, res) => {
    res.json({ lines: await repositories.audit.list(Number(req.query.limit) || 300) })
  })

  router.get('/api/admin/health', requireAdmin, async (_req, res) => {
    res.json({
      ok: true,
      config: publicConfigSummary(),
      providers: await repositories.providerHealth.all(),
    })
  })

  router.post('/api/admin/providers/probe', requireAdmin, async (_req, res) => {
    const results = await Promise.all([
      probe('plex', () => plexJson('/'), repositories),
      probe('tautulli', () => tautulliApi('get_server_info'), repositories),
    ])
    res.json({ ok: results.every((result) => result.ok), results })
  })

  router.get('/api/admin/sonarr/agent-logs', requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1_000)
    res.json({
      logs: sanitizeSonarrData(db.prepare(
        'SELECT * FROM sonarr_agent_logs ORDER BY ts DESC, id DESC LIMIT ?',
      ).all(limit)),
    })
  })

  router.get('/api/admin/config', requireAdmin, (_req, res) => {
    res.json({
      tenantId: config.entra.tenantId,
      roles: [...roles],
      providers: publicConfigSummary().providers,
    })
  })

  return router
}

async function probe(
  provider: string,
  call: () => Promise<unknown>,
  repositories: Repositories,
) {
  const startedAt = Date.now()
  try {
    await call()
    await repositories.providerHealth.record(provider, 'ok', startedAt)
    return { provider, ok: true, latencyMs: Date.now() - startedAt }
  } catch (error) {
    await repositories.providerHealth.record(provider, 'error', startedAt, error)
    return { provider, ok: false, latencyMs: Date.now() - startedAt }
  }
}
