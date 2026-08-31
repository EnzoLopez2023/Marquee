import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  frontendRuntimeConfig,
  loadConfig,
  resolveTenantId,
  userAuthenticationConfigured,
  validateConfig,
  watchtowerWorkloadConfigured,
} from '../../server/config.js'

const tenantId = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
const clientId = '11111111-1111-4111-8111-111111111111'
const adminOid = '22222222-2222-4222-8222-222222222222'
const computeTenantId = 'de625678-c55b-4494-9558-14946cbb6133'
const watchtowerClientId = '432a4d88-1144-4566-a960-321f813d850a'
const workloadAudience = 'api://55555555-5555-4555-8555-555555555555'
const directories: string[] = []

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(path.join('/tmp', 'marquee-production-config-'))
  directories.push(directory)
  return {
    NODE_ENV: 'production',
    CI: 'true',
    MARQUEE_EPHEMERAL_SMOKE: 'true',
    DB_PATH: path.join(directory, 'marquee.db'),
    MARQUEE_ARTIFACT_ROOT: path.join(directory, 'artifacts'),
    AZURE_AD_TENANT_ID: tenantId,
    AZURE_AD_CLIENT_ID: clientId,
    AZURE_AD_AUDIENCE: `api://${clientId}`,
    ADMIN_OID: adminOid,
    ...overrides,
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('production deployment configuration', () => {
  it('allows production startup without deferred identity integrations', () => {
    const env = productionEnvironment({
      AZURE_AD_TENANT_ID: '',
      AZURE_AD_CLIENT_ID: '',
      AZURE_AD_AUDIENCE: '',
      ADMIN_OID: '',
    })
    expect(() => validateConfig(loadConfig(env), env)).not.toThrow()
  })

  it('allows startup without optional workload client IDs', () => {
    const env = productionEnvironment()
    expect(() => validateConfig(loadConfig(env), env)).not.toThrow()
  })

  it('accepts configured workload IDs without weakening startup validation', () => {
    const env = productionEnvironment({
      WATCHTOWER_WORKLOAD_TENANT_ID: computeTenantId,
      WATCHTOWER_WORKLOAD_AUDIENCE: workloadAudience,
      WATCHTOWER_CLIENT_ID: watchtowerClientId,
      PRISM_CLIENT_ID: '44444444-4444-4444-8444-444444444444',
    })
    const candidate = loadConfig(env)
    expect(() => validateConfig(candidate, env)).not.toThrow()
    expect(watchtowerWorkloadConfigured(candidate)).toBe(true)
  })

  it.each([
    'WATCHTOWER_WORKLOAD_TENANT_ID',
    'WATCHTOWER_CLIENT_ID',
    'PRISM_CLIENT_ID',
  ])(
    'rejects a malformed configured %s',
    (name) => {
      const env = productionEnvironment({ [name]: 'not-a-guid' })
      expect(() => validateConfig(loadConfig(env), env)).toThrow(
        `${name} must be a GUID when configured`,
      )
    },
  )

  it('accepts only the two Entra audience forms for the combined registration', () => {
    for (const audience of [clientId, `api://${clientId}`]) {
      const env = productionEnvironment({ AZURE_AD_AUDIENCE: audience })
      expect(() => validateConfig(loadConfig(env), env)).not.toThrow()
    }
    const env = productionEnvironment({ AZURE_AD_AUDIENCE: 'api://other-app' })
    expect(() => validateConfig(loadConfig(env), env)).toThrow(
      'must match the Marquee client ID or identifier URI',
    )
  })

  it('keeps workload verification independent from interactive user authentication', () => {
    const env = productionEnvironment({
      AZURE_AD_TENANT_ID: '',
      AZURE_AD_CLIENT_ID: '',
      AZURE_AD_AUDIENCE: '',
      WATCHTOWER_WORKLOAD_TENANT_ID: computeTenantId,
      WATCHTOWER_WORKLOAD_AUDIENCE: workloadAudience,
      WATCHTOWER_CLIENT_ID: watchtowerClientId,
    })
    const candidate = loadConfig(env)
    expect(userAuthenticationConfigured(candidate)).toBe(false)
    expect(watchtowerWorkloadConfigured(candidate)).toBe(true)
  })

  it('fails the Watchtower route configuration closed when its audience is absent', () => {
    const candidate = loadConfig(productionEnvironment({
      WATCHTOWER_WORKLOAD_TENANT_ID: computeTenantId,
      WATCHTOWER_CLIENT_ID: watchtowerClientId,
    }))
    expect(watchtowerWorkloadConfigured(candidate)).toBe(false)
  })

  it('keeps user login unavailable when its audience is absent', () => {
    const env: NodeJS.ProcessEnv = productionEnvironment()
    delete env.AZURE_AD_AUDIENCE
    const candidate = loadConfig(env)
    expect(() => validateConfig(candidate, env)).not.toThrow()
    expect(() => frontendRuntimeConfig(candidate)).toThrow(
      'Marquee user login is not configured',
    )
  })

  it('accepts the legacy tenant alias only when it is unambiguous', () => {
    expect(resolveTenantId({ AAD_TENANT_ID: tenantId })).toBe(tenantId)
    expect(() => resolveTenantId({
      AZURE_AD_TENANT_ID: tenantId,
      AAD_TENANT_ID: clientId,
    })).toThrow('conflict')
  })

  it('keeps normal production storage under /home/data', () => {
    const env = productionEnvironment({
      CI: 'false',
      MARQUEE_EPHEMERAL_SMOKE: 'false',
    })
    expect(() => validateConfig(loadConfig(env), env)).toThrow(
      'DB_PATH must remain under /home/data',
    )
  })

  it('publishes only the non-secret combined registration values', () => {
    const runtime = frontendRuntimeConfig(loadConfig(productionEnvironment()))
    expect(runtime).toEqual({
      entraTenantId: tenantId,
      entraClientId: clientId,
      entraAudience: `api://${clientId}`,
      entraApiScope: `api://${clientId}/Marquee.User`,
    })
    expect(Object.keys(runtime).sort()).toEqual([
      'entraApiScope',
      'entraAudience',
      'entraClientId',
      'entraTenantId',
    ])
    expect(JSON.stringify(runtime)).not.toContain('ADMIN')
  })
})
