import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth/entra.js', () => ({
  verifyAccessToken: vi.fn(async () => ({
    tid: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
    oid: '11111111-1111-4111-8111-111111111111',
    scp: 'Marquee.User',
  })),
  assertDelegatedUserClaims: (claims: unknown) => claims,
  assertWorkloadClaims: (claims: unknown) => claims,
}))

import { createApp } from '../../server/app.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('production API fallback', () => {
  it('returns JSON 404 for authenticated unknown APIs before SPA fallback', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'marquee-spa-fallback-'))
    mkdirSync(path.join(root, 'dist'))
    writeFileSync(path.join(root, 'dist', 'index.html'), '<html>SPA</html>')
    const previousEnvironment = process.env.NODE_ENV
    const previousRoot = process.env.MARQUEE_ROOT
    process.env.NODE_ENV = 'production'
    process.env.MARQUEE_ROOT = root
    const handle = temporaryDatabase()
    try {
      const app = createApp(handle)
      await withServer(app, async (url) => {
        const api = await fetch(`${url}/api/does-not-exist`, {
          headers: { Authorization: 'Bearer test' },
        })
        expect(api.status).toBe(404)
        expect(api.headers.get('content-type')).toContain('application/json')
        expect(await api.json()).toEqual({ error: { code: 'NOT_FOUND' } })
        const apiRoot = await fetch(`${url}/api`, {
          headers: { Authorization: 'Bearer test' },
        })
        expect(apiRoot.status).toBe(404)
        expect(apiRoot.headers.get('content-type')).toContain('application/json')

        const page = await fetch(`${url}/some/client/route`)
        expect(page.status).toBe(200)
        expect(await page.text()).toContain('SPA')
      })
    } finally {
      handle.cleanup()
      process.env.NODE_ENV = previousEnvironment
      process.env.MARQUEE_ROOT = previousRoot
      rmSync(root, { recursive: true, force: true })
    }
  })
})
