import express from 'express'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth/serviceTokens.js', () => ({
  requireWorkload: () => (req: any, res: any, next: any) => (
    req.get('authorization') === 'Bearer workload-test-token'
      ? next()
      : res.status(401).json({ error: { code: 'INVALID_WORKLOAD_TOKEN' } })
  ),
}))

import { createContractsV1Router } from '../../server/routes/contractsV1.js'
import { sonarrCollectionStatus } from '../../server/routes/contractsV1.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('Watchtower media health contract', () => {
  it('degrades or becomes unavailable for Sonarr endpoint failures', () => {
    expect(sonarrCollectionStatus({
      collection: { healthyEndpointCount: 9, failedEndpointCount: 1 },
    })).toBe('degraded')
    expect(sonarrCollectionStatus({
      collection: { healthyEndpointCount: 0, failedEndpointCount: 10 },
    })).toBe('unavailable')
    expect(sonarrCollectionStatus({
      collection: { healthyEndpointCount: 10, failedEndpointCount: 0 },
    })).toBe('healthy')
    expect(sonarrCollectionStatus({
      collection: { healthyEndpointCount: 0, failedEndpointCount: 0 },
    })).toBe('unavailable')
  })

  it('is token-gated, compact, read-only, and versioned', async () => {
    const handle = temporaryDatabase()
    handle.db.prepare(`
      INSERT INTO sonarr_summary(id, sampled_at, received_at, poll_minutes, payload)
      VALUES (1, ?, ?, 2, ?)
    `).run(Date.now(), Date.now(), JSON.stringify({
      metrics: { seriesCount: 416, queueCount: 0, missingCount: 2, healthIssueCount: 0 },
      pipeline: { grabbed24h: 1, imported24h: 1, failed24h: 0 },
      collection: { endpointCount: 10, healthyEndpointCount: 10, failedEndpointCount: 0 },
    }))
    const app = express().use(express.json()).use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        expect((await fetch(`${url}/api/contracts/v1/media-health`)).status).toBe(401)
        const response = await fetch(`${url}/api/contracts/v1/media-health`, {
          headers: { Authorization: 'Bearer workload-test-token' },
        })
        expect(response.status).toBe(200)
        const data = await response.json() as any
        expect(data.schema).toBe('marquee.media-health.v1')
        expect(data.sonarr.metrics.seriesCount).toBe(416)
        expect(JSON.stringify(data)).not.toContain('payload')
        expect(JSON.stringify(data)).not.toContain('file_path')

        handle.db.prepare(`
          UPDATE sonarr_summary SET payload = ? WHERE id = 1
        `).run(JSON.stringify({
          metrics: { seriesCount: 416 },
          pipeline: {},
          collection: { endpointCount: 10, healthyEndpointCount: 9, failedEndpointCount: 1 },
        }))
        const degraded = await fetch(`${url}/api/contracts/v1/media-health`, {
          headers: { Authorization: 'Bearer workload-test-token' },
        })
        expect((await degraded.json() as any).status).toBe('degraded')
      })
    } finally {
      handle.cleanup()
    }
  })
})
