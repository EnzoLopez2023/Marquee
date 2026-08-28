import { describe, expect, it } from 'vitest'
import express from 'express'
import { createRepositories } from '../../lib/db/repositories/index.js'
import { createAuditRouter } from '../../server/routes/audit.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('client audit trust boundary', () => {
  it('rejects forged authoritative fields and stores allow-listed telemetry as non-authoritative', async () => {
    const handle = temporaryDatabase()
    const repositories = createRepositories(handle.db)
    const identity = {
      tenantId: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
      oid: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.test',
      name: 'Test User',
    }
    const app = express()
      .use(express.json())
      .use((req, _res, next) => { req.identity = identity; next() })
      .use(createAuditRouter(repositories))
    try {
      await withServer(app, async (url) => {
        const forged = await fetch(`${url}/api/audit/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: [{
              category: 'change',
              action: 'Administrator changed roles',
              ts: 1,
              kind: 'not_allowed',
            }],
          }),
        })
        expect(forged.status).toBe(400)

        const before = Date.now()
        const accepted = await fetch(`${url}/api/audit/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: [{
              kind: 'navigation',
              view: 'plex-library',
              detail: 'Opened library',
              category: 'change',
              action: 'Forged action',
              ts: 1,
            }],
          }),
        })
        expect(accepted.status).toBe(200)
        const row = handle.db.prepare(`
          SELECT ts, received_at, category, action, authoritative, source, verified
          FROM app_audit_log
        `).get() as any
        expect(row.ts).toBeGreaterThanOrEqual(before)
        expect(row.received_at).toBe(row.ts)
        expect(row).toMatchObject({
          category: 'telemetry',
          action: 'Client navigation',
          authoritative: 0,
          source: 'client',
          verified: 1,
        })
      })
    } finally {
      handle.cleanup()
    }
  })
})
