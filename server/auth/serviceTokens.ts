import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { assertWorkloadClaims, verifyAccessToken } from './entra.js'
import { config } from '../config.js'

const bearer = (req: Request) => {
  const auth = req.get('authorization') || ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

export function requireWorkload(
  consumer: 'watchtower' | 'prism',
  permission: 'read' | 'write',
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientId = consumer === 'watchtower'
      ? config.entra.workloads.watchtower.clientId
      : config.entra.workloads.prism.clientId
    if (!clientId) {
      return res.status(503).json({
        error: {
          code: 'WORKLOAD_IDENTITY_NOT_CONFIGURED',
          dependency: consumer,
        },
      })
    }
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: { code: 'WORKLOAD_TOKEN_REQUIRED' } })
    const role = consumer === 'watchtower'
      ? config.entra.workloads.watchtower.role
      : permission === 'write'
        ? config.entra.workloads.prism.writeRole
        : config.entra.workloads.prism.readRole
    try {
      assertWorkloadClaims(await verifyAccessToken(token), clientId, role)
      req.serviceConsumer = consumer
      return next()
    } catch (error) {
      console.warn('Workload access token rejected:', error instanceof Error ? error.message : String(error))
      return res.status(401).json({ error: { code: 'INVALID_WORKLOAD_TOKEN' } })
    }
  }
}

function matches(provided: string, expected: string) {
  if (!provided || !expected) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function requireSonarrAgent(req: Request, res: Response, next: NextFunction) {
  if (!config.sonarrIngestToken) {
    return res.status(503).json({ error: { code: 'SONARR_INGEST_NOT_CONFIGURED' } })
  }
  if (!matches(bearer(req), config.sonarrIngestToken)) {
    return res.status(401).json({ error: { code: 'INVALID_SERVICE_TOKEN' } })
  }
  req.serviceConsumer = 'sonarr'
  return next()
}
