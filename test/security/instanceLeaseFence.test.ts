import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('runtime instance lease fence', () => {
  it('keeps liveness visible but rejects application requests after ownership loss', async () => {
    const handle = temporaryDatabase()
    const app = createApp(handle)
    try {
      await withServer(app, async (url) => {
        handle.db.prepare(`
          UPDATE runtime_instance_lease
          SET owner_id = 'other-process', expires_at = ?
          WHERE id = 1
        `).run(Date.now() + 60_000)
        const live = await fetch(`${url}/api/live`)
        expect(live.status).toBe(200)
        const application = await fetch(`${url}/api/sonarr/dashboard`)
        expect(application.status).toBe(503)
        expect(await application.json()).toEqual({
          error: { code: 'INSTANCE_LEASE_LOST' },
        })
      })
    } finally {
      handle.cleanup()
    }
  })
})
