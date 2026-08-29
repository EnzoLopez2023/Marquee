import { Router } from 'express'
import type { DatabaseHandle } from '../../lib/db/connection.js'
import { SOURCE } from '../../lib/health/buildIdentity.js'
import { liveness, readiness } from '../../lib/health/readiness.js'
import { config, frontendRuntimeConfig, type MarqueeConfig } from '../config.js'

export function createHealthRouter(
  handle: DatabaseHandle,
  runtimeConfig: MarqueeConfig = config,
) {
  const router = Router()
  router.get('/api/live', (_req, res) => res.json(liveness()))
  router.get('/api/ready', (_req, res) => {
    const result = readiness(handle)
    res.status(result.statusCode).json(result.payload)
  })
  router.get('/api/version', (_req, res) => res.json(SOURCE))
  router.get('/version.json', (_req, res) => res.json(SOURCE))
  router.get('/api/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      return res.json(frontendRuntimeConfig(runtimeConfig))
    } catch {
      return res.status(503).json({
        error: { code: 'USER_LOGIN_NOT_CONFIGURED' },
      })
    }
  })
  return router
}
