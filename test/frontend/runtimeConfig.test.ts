import { describe, expect, it } from 'vitest'
import {
  fetchBrowserRuntimeConfig,
  validateRuntimeConfig,
} from '../../src/auth/runtimeConfig.js'

const tenant = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
const client = '11111111-1111-4111-8111-111111111111'

describe('frontend runtime configuration', () => {
  it('accepts only exact GUID values and the exact Marquee.User scope', () => {
    expect(validateRuntimeConfig({
      entraTenantId: tenant,
      entraClientId: client,
      entraApiScope: `api://${client}/Marquee.User`,
    })).toBeTruthy()
    expect(() => validateRuntimeConfig(undefined)).toThrow('missing')
    expect(() => validateRuntimeConfig({
      entraTenantId: tenant,
      entraClientId: client,
      entraApiScope: `api://${client}/access_as_user`,
    })).toThrow('scope')
  })

  it('loads the no-store JSON endpoint and fails closed on an unhealthy response', async () => {
    const expected = {
      entraTenantId: tenant,
      entraClientId: client,
      entraApiScope: `api://${client}/Marquee.User`,
    }
    const fetcher = async () => new Response(JSON.stringify(expected), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(fetchBrowserRuntimeConfig(fetcher as typeof fetch)).resolves.toEqual(expected)
    await expect(fetchBrowserRuntimeConfig(
      (async () => new Response(null, { status: 503 })) as typeof fetch,
    )).rejects.toThrow('unavailable (503)')
  })
})
