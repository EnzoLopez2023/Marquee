import path from 'node:path'
import cors from 'cors'
import express, { type RequestHandler } from 'express'
import type { DatabaseHandle } from '../lib/db/connection.js'
import { createRepositories } from '../lib/db/repositories/index.js'
import { createAuthorization } from './auth/authorize.js'
import { requireSonarrAgent } from './auth/serviceTokens.js'
import { createAuditRouter } from './routes/audit.js'
import { createAdminRouter } from './routes/admin.js'
import { createContractsV1Router } from './routes/contractsV1.js'
import { createHealthRouter } from './routes/health.js'
import playlistCreatorRoutes from './routes/playlistCreator.js'
import plexRoutes from './routes/plex.js'
import { createPlexDuplicatesRouter } from './routes/plexDuplicates.js'
import { createSonarrRouter } from './routes/sonarr.js'
import tautulliRoutes from './routes/tautulli.js'
import { config } from './config.js'
import { plexTlsMode } from './domain/media/plexTls.js'

export function createApp(handle: DatabaseHandle) {
  const app = express()
  const repositories = createRepositories(handle.db)
  const auth = createAuthorization(repositories)
  const plexTransport = plexTlsMode(config.plex.baseUrl, config.plex.tls)
  if (plexTransport.degraded) {
    const detail = 'Plex TLS verification is explicitly disabled for compatibility'
    void repositories.providerHealth.record('plex', 'error', Date.now(), new Error(detail))
    void repositories.audit.append({
      category: 'change',
      action: 'Plex TLS insecure compatibility enabled',
      detail,
    }, null, null)
  }

  app.disable('x-powered-by')
  app.use(cors())
  app.use(createHealthRouter(handle))
  app.use((_req, res, next) => {
    try {
      handle.assertInstanceLease()
      return next()
    } catch {
      return res.status(503).json({ error: { code: 'INSTANCE_LEASE_LOST' } })
    }
  })
  const sonarrAgentPaths = [
    '/api/sonarr/agent-check',
    '/api/sonarr/ingest',
    '/api/sonarr/agent-logs/ingest',
  ]
  app.use(sonarrAgentPaths, requireSonarrAgent)
  app.use(sonarrAgentPaths, express.json({ limit: '17mb' }))
  app.use(express.json({ limit: '2mb' }))
  app.use(createContractsV1Router(handle.db))

  app.use('/api', (req, res, next) => {
    if (
      req.path === '/sonarr/agent-check'
      || req.path === '/sonarr/ingest'
      || req.path === '/sonarr/agent-logs/ingest'
    ) return next()
    return auth.requireUser(req, res, next)
  })
  app.use('/api/plex/duplicates/delete', auth.requireRole('duplicate_delete'))
  app.use('/api/plex/duplicates/delete', auth.requireFeatureEdit('plex-command-center'))
  app.use('/api/plex/duplicates', (req, res, next) => {
    const path = normalizeExpressPath(req.path)
    if (duplicateResponseContainsPaths(path)) {
      return auth.requireRole('duplicate_delete')(req, res, () => (
        auth.requireFeatureEdit('plex-command-center')(req, res, next)
      ))
    }
    return auth.requireFeature('plex-command-center')(req, res, next)
  })
  app.use('/api/tautulli', auth.requireFeature('plex-command-center'))
  app.use('/api/movie', auth.requireFeature('plex-library'))
  app.use('/api/plex', (req, res, next) => {
    const normalizedPath = normalizeExpressPath(req.path)
    if (normalizedPath.startsWith('/duplicates')) return next()
    const ownership = plexRouteOwnership(normalizedPath, req.method)
    if (ownership === 'shared') {
      return auth.requireAnyFeature(['plex-library', 'plex-command-center'])(req, res, next)
    }
    return auth.requireFeature(ownership)(req, res, next)
  })
  app.use('/api/playlist-creator', auth.requireFeature('plex-library'))
  app.use('/api/sonarr', (req, res, next) => {
    if (
      req.path === '/agent-check'
      || req.path === '/ingest'
      || req.path === '/agent-logs/ingest'
    ) return next()
    return auth.requireFeature('sonarr-dashboard')(req, res, next)
  })
  app.use('/api/playlist-creator', auth.requireFeatureEdit('plex-library'))
  app.use('/api/plex', mutationRole(auth.requireFeatureEdit('plex-library')))
  app.use(createSonarrRouter(handle.db))
  app.use(plexRoutes)
  app.use(tautulliRoutes)
  app.use(createPlexDuplicatesRouter(handle.db, {
    assert: () => handle.assertInstanceLease(),
    onLost: (listener) => handle.onInstanceLeaseLost(listener),
  }))
  app.use(playlistCreatorRoutes)
  app.use(createAuditRouter(repositories))
  app.use(createAdminRouter(handle.db, repositories, auth.requireRole('admin')))
  const apiNotFound = (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND' } })
  }
  app.all('/api', apiNotFound)
  app.all('/api/{*path}', apiNotFound)

  if (process.env.NODE_ENV === 'production') {
    const client = path.resolve(process.env.MARQUEE_ROOT || '.', 'dist')
    app.use(express.static(client))
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(client, 'index.html')))
  }

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }))
  app.use(((error, _req, res, _next) => {
    console.error('Unhandled request error:', error)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR' } })
  }) as express.ErrorRequestHandler)
  return app
}

export function plexRouteOwnership(
  routePath: string,
  method: string,
): 'plex-library' | 'plex-command-center' | 'shared' {
  const normalizedPath = normalizeExpressPath(routePath)
  if (normalizedPath === '/image') return 'shared'
  if (method.toUpperCase() === 'GET' && (
    /^\/library\/[^/]+\/playlists$/.test(normalizedPath)
    || /^\/playlists\/[^/]+\/items$/.test(normalizedPath)
    || normalizedPath === '/playlists'
  )) return 'plex-command-center'
  return 'plex-library'
}

export function normalizeExpressPath(routePath: string) {
  const lower = routePath.toLowerCase()
  const withoutTrailing = lower.replace(/\/+$/, '')
  return withoutTrailing || '/'
}

export function duplicateResponseContainsPaths(routePath: string) {
  const normalized = normalizeExpressPath(routePath)
  return normalized === '/scan' || normalized === '/audit'
}

function mutationRole(requireEditor: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
      && normalizeExpressPath(req.path) !== '/duplicates/delete'
    ) {
      return requireEditor(req, res, next)
    }
    return next()
  }
}
