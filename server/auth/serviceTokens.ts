import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import {
  assertWorkloadClaims,
  verifyAccessToken,
  verifyAccessTokenForAuthority,
  type TokenAuthority,
  type VerifiedClaims,
} from './entra.js'
import {
  config,
  userAuthenticationConfigured,
  watchtowerWorkloadConfigured,
  type MarqueeConfig,
} from '../config.js'

const bearer = (req: Request) => {
  const auth = req.get('authorization') || ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

export function requireWorkload(
  consumer: 'prism',
  permission: 'read' | 'write',
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientId = config.entra.workloads.prism.clientId
    if (!clientId || !userAuthenticationConfigured()) {
      return res.status(503).json({
        error: {
          code: 'WORKLOAD_IDENTITY_NOT_CONFIGURED',
          dependency: consumer,
        },
      })
    }
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: { code: 'WORKLOAD_TOKEN_REQUIRED' } })
    const role = permission === 'write'
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

type WorkloadVerifier = (
  token: string,
  authority: TokenAuthority,
) => Promise<VerifiedClaims>

export function requireWatchtower(
  candidate: MarqueeConfig = config,
  verify: WorkloadVerifier = verifyAccessTokenForAuthority,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!watchtowerWorkloadConfigured(candidate)) {
      return res.status(503).json({
        error: {
          code: 'WORKLOAD_IDENTITY_NOT_CONFIGURED',
          dependency: 'watchtower',
        },
      })
    }
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: { code: 'WORKLOAD_TOKEN_REQUIRED' } })

    const workload = candidate.entra.workloads.watchtower
    try {
      const claims = await verify(token, {
        tenantId: workload.tenantId,
        audience: workload.audience,
      })
      assertWorkloadClaims(claims, workload.clientId, workload.role)
      req.serviceConsumer = 'watchtower'
      return next()
    } catch (error) {
      console.warn('Watchtower access token rejected:', error instanceof Error ? error.message : String(error))
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
