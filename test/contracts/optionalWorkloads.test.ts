import express from 'express'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('../../server/auth/serviceTokens.js')
import { createContractsV1Router } from '../../server/routes/contractsV1.js'
import { createHealthRouter } from '../../server/routes/health.js'
import { loadConfig } from '../../server/config.js'
import { temporaryDatabase, withServer } from '../helpers.js'

const tenantId = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
const clientId = '11111111-1111-4111-8111-111111111111'

describe('optional workload identities', () => {
  it('fails only Watchtower and Prism contract routes when their IDs are absent', async () => {
    const handle = temporaryDatabase()
    const app = express()
      .use(express.json())
      .use(createHealthRouter(handle, loadConfig({
        AZURE_AD_TENANT_ID: tenantId,
        AZURE_AD_CLIENT_ID: clientId,
      })))
      .use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        const checks = [
          ['GET', '/api/contracts/v1/media-health', 'watchtower'],
          ['GET', '/api/contracts/v1/media/search?q=test', 'prism'],
          ['GET', '/api/contracts/v1/media/artwork/missing', 'prism'],
          ['POST', '/api/contracts/v1/playlists/prepare', 'prism'],
          ['POST', '/api/contracts/v1/playlists/commit', 'prism'],
          ['POST', '/api/contracts/v1/collections/prepare', 'prism'],
          ['POST', '/api/contracts/v1/collections/commit', 'prism'],
        ] as const
        for (const [method, route, dependency] of checks) {
          const response = await fetch(`${url}${route}`, { method })
          expect(response.status, route).toBe(503)
          expect(await response.json(), route).toEqual({
            error: {
              code: 'WORKLOAD_IDENTITY_NOT_CONFIGURED',
              dependency,
            },
          })
        }

        expect((await fetch(`${url}/api/live`)).status).toBe(200)
        expect((await fetch(`${url}/api/ready`)).status).toBe(200)
        expect((await fetch(`${url}/api/config`)).status).toBe(200)
      })
    } finally {
      handle.cleanup()
    }
  })

  it('keeps liveness available but fails runtime login configuration closed', async () => {
    const handle = temporaryDatabase()
    const app = express().use(createHealthRouter(handle, loadConfig({})))
    try {
      await withServer(app, async (url) => {
        expect((await fetch(`${url}/api/live`)).status).toBe(200)
        const response = await fetch(`${url}/api/config`)
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
          error: { code: 'USER_LOGIN_NOT_CONFIGURED' },
        })
      })
    } finally {
      handle.cleanup()
    }
  })
})
