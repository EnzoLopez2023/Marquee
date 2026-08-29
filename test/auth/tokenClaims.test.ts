import { describe, expect, it } from 'vitest'
import type { VerifiedClaims } from '../../server/auth/entra.js'
import {
  assertDelegatedUserClaims,
  assertWorkloadClaims,
} from '../../server/auth/entra.js'

const base = {
  tid: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
  oid: '11111111-1111-4111-8111-111111111111',
} satisfies Partial<VerifiedClaims>
const watchtowerClient = '22222222-2222-4222-8222-222222222222'
const prismClient = '33333333-3333-4333-8333-333333333333'

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
})
