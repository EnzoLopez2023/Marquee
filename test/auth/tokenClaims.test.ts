import { describe, expect, it } from 'vitest'
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose'
import type { VerifiedClaims } from '../../server/auth/entra.js'
import {
  assertDelegatedUserClaims,
  assertWorkloadClaims,
  verifyAccessTokenForAuthority,
} from '../../server/auth/entra.js'

const base = {
  tid: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
  oid: '11111111-1111-4111-8111-111111111111',
} satisfies Partial<VerifiedClaims>
const watchtowerClient = '22222222-2222-4222-8222-222222222222'
const prismClient = '33333333-3333-4333-8333-333333333333'
const workloadTenant = 'de625678-c55b-4494-9558-14946cbb6133'
const workloadAudience = 'api://44444444-4444-4444-8444-444444444444'
const workloadRole = 'Marquee.Watchtower.MediaHealth.Read'

async function signedWorkloadToken(options: {
  tid?: string
  audience?: string
  clientId?: string
  roles?: string[]
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const kid = 'watchtower-test-key'
  const publicJwk = { ...await exportJWK(publicKey), kid }
  const token = await new SignJWT({
    tid: options.tid ?? workloadTenant,
    oid: '48f19c71-468e-4310-85a8-e32e41e6b091',
    azp: options.clientId ?? watchtowerClient,
    ...(options.roles ? { roles: options.roles } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(`https://login.microsoftonline.com/${workloadTenant}/v2.0`)
    .setAudience(options.audience ?? workloadAudience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  return {
    token,
    keySet: createLocalJWKSet({ keys: [publicJwk] }),
  }
}

describe('Entra token claim boundaries', () => {
  it('requires the exact delegated Marquee user scope', () => {
    expect(assertDelegatedUserClaims({
      ...base,
      scp: 'openid Marquee.User',
    } as VerifiedClaims)).toBeTruthy()
    expect(() => assertDelegatedUserClaims({
      ...base,
      roles: ['Marquee.Prism.Media.Read'],
    } as VerifiedClaims)).toThrow('delegated scope')
    expect(() => assertDelegatedUserClaims({
      ...base,
      scp: 'Other.Scope',
    } as VerifiedClaims)).toThrow('delegated scope')
  })

  it('requires app-only workload tokens from the exact client and app role', () => {
    expect(assertWorkloadClaims({
      ...base,
      azp: watchtowerClient,
      roles: ['Marquee.Watchtower.MediaHealth.Read'],
    } as VerifiedClaims, watchtowerClient, 'Marquee.Watchtower.MediaHealth.Read')).toBeTruthy()
    expect(assertWorkloadClaims({
      ...base,
      azp: watchtowerClient.toUpperCase(),
      roles: ['Marquee.Watchtower.MediaHealth.Read'],
    } as VerifiedClaims, watchtowerClient, 'Marquee.Watchtower.MediaHealth.Read')).toBeTruthy()
    expect(() => assertWorkloadClaims({
      ...base,
      azp: watchtowerClient,
      scp: 'Marquee.User',
      roles: ['Marquee.Watchtower.MediaHealth.Read'],
    } as VerifiedClaims, watchtowerClient, 'Marquee.Watchtower.MediaHealth.Read'))
      .toThrow('Delegated tokens')
    expect(() => assertWorkloadClaims({
      ...base,
      azp: prismClient,
      roles: ['Marquee.Prism.Media.Read'],
    } as VerifiedClaims, watchtowerClient, 'Marquee.Watchtower.MediaHealth.Read'))
      .toThrow('client or application role')
  })

  it('rejects a workload token from the wrong tenant', async () => {
    const { token, keySet } = await signedWorkloadToken({
      tid: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
      roles: [workloadRole],
    })
    await expect(verifyAccessTokenForAuthority(token, {
      tenantId: workloadTenant,
      audience: workloadAudience,
    }, keySet)).rejects.toThrow('invalid tenant')
  })

  it('rejects a workload token with the wrong audience', async () => {
    const { token, keySet } = await signedWorkloadToken({
      audience: 'api://55555555-5555-4555-8555-555555555555',
      roles: [workloadRole],
    })
    await expect(verifyAccessTokenForAuthority(token, {
      tenantId: workloadTenant,
      audience: workloadAudience,
    }, keySet)).rejects.toThrow()
  })

  it('rejects the wrong workload caller and a missing application role', async () => {
    const wrongCaller = await signedWorkloadToken({
      clientId: prismClient,
      roles: [workloadRole],
    })
    const wrongCallerClaims = await verifyAccessTokenForAuthority(wrongCaller.token, {
      tenantId: workloadTenant,
      audience: workloadAudience,
    }, wrongCaller.keySet)
    expect(() => assertWorkloadClaims(
      wrongCallerClaims,
      watchtowerClient,
      workloadRole,
    )).toThrow('client or application role')

    const missingRole = await signedWorkloadToken()
    const missingRoleClaims = await verifyAccessTokenForAuthority(missingRole.token, {
      tenantId: workloadTenant,
      audience: workloadAudience,
    }, missingRole.keySet)
    expect(() => assertWorkloadClaims(
      missingRoleClaims,
      watchtowerClient,
      workloadRole,
    )).toThrow('client or application role')
  })

  it('accepts a valid Watchtower workload token', async () => {
    const { token, keySet } = await signedWorkloadToken({ roles: [workloadRole] })
    const claims = await verifyAccessTokenForAuthority(token, {
      tenantId: workloadTenant,
      audience: workloadAudience,
    }, keySet)
    expect(assertWorkloadClaims(claims, watchtowerClient, workloadRole)).toMatchObject({
      tid: workloadTenant,
      azp: watchtowerClient,
      roles: [workloadRole],
    })
  })
})
