import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { config } from '../config.js'

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function keySet() {
  if (!jwks) {
    if (!config.entra.tenantId) throw new Error('Entra authentication is not configured')
    jwks = createRemoteJWKSet(new URL(
      `https://login.microsoftonline.com/${config.entra.tenantId}/discovery/v2.0/keys`,
    ))
  }
  return jwks
}

export interface VerifiedClaims extends JWTPayload {
  oid: string
  tid: string
}

export async function verifyAccessToken(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, keySet(), {
    issuer: [
      `https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`,
      `https://sts.windows.net/${config.entra.tenantId}/`,
    ],
    audience: config.entra.audience,
    clockTolerance: 60,
  })
  if (
    typeof payload.tid !== 'string'
    || payload.tid.toLowerCase() !== config.entra.tenantId
    || typeof payload.oid !== 'string'
    || !guid.test(payload.oid)
    || !guid.test(payload.tid)
  ) {
    throw new Error('Token has an invalid tenant or object identifier')
  }
  return {
    ...payload,
    tid: payload.tid.toLowerCase(),
    oid: payload.oid.toLowerCase(),
  } as VerifiedClaims
}

export function assertDelegatedUserClaims(claims: VerifiedClaims): VerifiedClaims {
  const scopes = typeof claims.scp === 'string' ? claims.scp.split(/\s+/).filter(Boolean) : []
  if (!scopes.includes(config.entra.userScope)) {
    throw new Error(`Token is missing delegated scope ${config.entra.userScope}`)
  }
  return claims
}

export function assertWorkloadClaims(
  claims: VerifiedClaims,
  expectedClientId: string,
  expectedRole: string,
): VerifiedClaims {
  if (!expectedClientId) throw new Error('Workload identity is not configured')
  if (typeof claims.scp === 'string' && claims.scp.trim()) {
    throw new Error('Delegated tokens cannot call workload endpoints')
  }
  const clientId = typeof claims.azp === 'string'
    ? claims.azp
    : typeof claims.appid === 'string' ? claims.appid : ''
  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === 'string')
    : []
  if (clientId.toLowerCase() !== expectedClientId.toLowerCase() || !roles.includes(expectedRole)) {
    throw new Error('Workload client or application role is invalid')
  }
  return claims
}
