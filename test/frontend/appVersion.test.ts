import { describe, expect, it } from 'vitest'
import { fetchAppVersion } from '../../src/services/appVersion.js'

describe('app version', () => {
  it('loads and validates the public build version', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      version: '0.1.0+run.42',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(fetchAppVersion(fetcher as typeof fetch)).resolves.toBe('0.1.0+run.42')
  })

  it('rejects unavailable and malformed version responses', async () => {
    await expect(fetchAppVersion(
      (async () => new Response(null, { status: 503 })) as typeof fetch,
    )).rejects.toThrow('failed (503)')
    await expect(fetchAppVersion(
      (async () => new Response(JSON.stringify({ version: '' }))) as typeof fetch,
    )).rejects.toThrow('invalid')
  })
})
