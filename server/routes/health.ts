import { Router } from 'express'
import type { DatabaseHandle } from '../../lib/db/connection.js'
import { SOURCE } from '../../lib/health/buildIdentity.js'
import { liveness, readiness } from '../../lib/health/readiness.js'
import { frontendRuntimeConfig } from '../config.js'

export function createHealthRouter(handle: DatabaseHandle) {
  const router = Router()
  router.get('/api/live', (_req, res) => res.json(liveness()))
  router.get('/api/ready', (_req, res) => {
    const result = readiness(handle)
    res.status(result.statusCode).json(result.payload)
  })
  router.get('/api/version', (_req, res) => res.json(SOURCE))
  router.get('/version.json', (_req, res) => res.json(SOURCE))
  router.get('/runtime-config.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(`window.__MARQUEE_RUNTIME_CONFIG__=${JSON.stringify(frontendRuntimeConfig())};`)
  })
  return router
}
