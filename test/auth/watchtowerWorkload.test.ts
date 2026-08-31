import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { VerifiedClaims } from '../../server/auth/entra.js'
import { requireWatchtower } from '../../server/auth/serviceTokens.js'
import { loadConfig } from '../../server/config.js'
import { withServer } from '../helpers.js'

const tenantId = 'de625678-c55b-4494-9558-14946cbb6133'
const audience = 'api://44444444-4444-4444-8444-444444444444'
const clientId = '432a4d88-1144-4566-a960-321f813d850a'
const role = 'Marquee.Watchtower.MediaHealth.Read'
const authorization = ['Bearer', 'signed-workload-token'].join(' ')

const candidate = loadConfig({
  WATCHTOWER_WORKLOAD_TENANT_ID: tenantId,
  WATCHTOWER_WORKLOAD_AUDIENCE: audience,
  WATCHTOWER_CLIENT_ID: clientId,
})

async function requestWithClaims(claims: VerifiedClaims) {
  const verify = vi.fn(async (_token: string, authority: {
    tenantId: string
    audience: string
  }) => {
    expect(authority).toEqual({ tenantId, audience })
    return claims
  })
  const app = express().get(
    '/api/contracts/v1/media-health',
    requireWatchtower(candidate, verify),
    (_req, res) => res.json({ ok: true }),
  )
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return withServer(app, async (url) => {
    const response = await fetch(
      `${url}/api/contracts/v1/media-health`,
      { headers: { authorization } },
    )
    return {
      status: response.status,
      body: await response.json() as unknown,
    }
  })
}

describe('Watchtower workload authorization', () => {
  it('rejects the wrong caller application', async () => {
    const response = await requestWithClaims({
      tid: tenantId,
      oid: '48f19c71-468e-4310-85a8-e32e41e6b091',
      azp: '33333333-3333-4333-8333-333333333333',
      roles: [role],
    })
    expect(response.status).toBe(401)
  })

  it('rejects a token without the exact application role', async () => {
    const response = await requestWithClaims({
      tid: tenantId,
      oid: '48f19c71-468e-4310-85a8-e32e41e6b091',
      azp: clientId,
      roles: ['Marquee.Watchtower.Other'],
    })
    expect(response.status).toBe(401)
  })

  it('accepts the exact caller and application role', async () => {
    const response = await requestWithClaims({
      tid: tenantId,
      oid: '48f19c71-468e-4310-85a8-e32e41e6b091',
      azp: clientId,
      roles: [role],
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
  })
})
