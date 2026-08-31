import express from 'express'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth/serviceTokens.js', () => ({
  requireWatchtower: () => (_req: any, _res: any, next: any) => next(),
  requireWorkload: () => (_req: any, _res: any, next: any) => next(),
}))

import { SCHEMA_VERSION } from '../../lib/db/migrate.js'
import { SOURCE } from '../../lib/health/buildIdentity.js'
import {
  createContractsV1Router,
  sonarrCollectionStatus,
} from '../../server/routes/contractsV1.js'
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

  it('emits the exact compact shape consumed by Watchtower', async () => {
    const handle = temporaryDatabase()
    const sampledAt = Date.now()
    const plexObservedAt = Date.parse('2026-08-28T05:37:30.000Z')
    const tautulliObservedAt = Date.parse('2026-08-28T05:37:00.000Z')
    handle.db.prepare(`
      INSERT INTO sonarr_summary(id, sampled_at, received_at, poll_minutes, payload)
      VALUES (1, ?, ?, 2, ?)
    `).run(sampledAt, sampledAt, JSON.stringify({
      metrics: { seriesCount: 416, queueCount: 0, missingCount: 2, healthIssueCount: 0 },
      pipeline: { grabbed24h: 1, imported24h: 1, failed24h: 0 },
      collection: { endpointCount: 10, healthyEndpointCount: 10, failedEndpointCount: 0 },
    }))
    handle.db.prepare(`
      INSERT INTO provider_health(provider, observed_at, status, latency_ms, sanitized_error)
      VALUES ('plex', ?, 'ok', 34, NULL), ('tautulli', ?, 'ok', 25, NULL)
    `).run(plexObservedAt, tautulliObservedAt)
    const app = express().use(express.json()).use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/contracts/v1/media-health`)
        expect(response.status).toBe(200)
        expect((await fetch(`${url}/api/contracts/v1/media-health`, {
          method: 'POST',
        })).status).toBe(404)
        const data = await response.json() as any
        expect(data).toEqual({
          schema: 'marquee.media-health.v1',
          generatedAt: expect.any(String),
          overall: 'healthy',
          build: SOURCE,
          sqlite: { ready: true, schemaVersion: SCHEMA_VERSION },
          providers: {
            plex: {
              configured: false,
              lastSuccessAt: '2026-08-28T05:37:30.000Z',
              lastFailureAt: null,
              latencyMs: 34,
            },
            tautulli: {
              configured: false,
              lastSuccessAt: '2026-08-28T05:37:00.000Z',
              lastFailureAt: null,
              latencyMs: 25,
            },
          },
          sonarr: {
            present: true,
            freshness: 'fresh',
            sampledAt,
            receivedAt: sampledAt,
            cadenceMs: 120_000,
            series: 416,
            queue: 0,
            missing: 2,
            healthy: 10,
            pipeline: 'healthy',
          },
          duplicates: {
            lastScanAt: null,
            successfulDeleteCount: 0,
            bytesSaved: 0,
            latestDeleteOutcomeAt: null,
          },
        })
        expect(JSON.stringify(data)).not.toContain('payload')
        expect(JSON.stringify(data)).not.toContain('file_path')
        expect(response.headers.get('cache-control')).toBe('no-store')

        handle.db.prepare(`
          UPDATE sonarr_summary SET payload = ? WHERE id = 1
        `).run(JSON.stringify({
          metrics: { seriesCount: 416 },
          pipeline: {},
          collection: { endpointCount: 10, healthyEndpointCount: 9, failedEndpointCount: 1 },
        }))
        const degraded = await fetch(`${url}/api/contracts/v1/media-health`)
        expect((await degraded.json() as any).overall).toBe('degraded')
      })
    } finally {
      handle.cleanup()
    }
  })
})
