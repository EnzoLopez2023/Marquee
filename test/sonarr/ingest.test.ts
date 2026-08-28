import { gzipSync } from 'node:zlib'
import express from 'express'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.SONARR_INGEST_TOKEN = 'sonarr-test-token'
})

import { createSonarrRouter } from '../../server/routes/sonarr.js'
import { requireSonarrAgent } from '../../server/auth/serviceTokens.js'
import { temporaryDatabase, withServer } from '../helpers.js'
import { unpackJson } from '../../server/domain/sonarr/codec.js'

const snapshot = {
  schema: 1,
  sampled_at: Date.now(),
  agent: { poll_minutes: 2 },
  source: {
    startupPath: 'C:\\ProgramData\\Sonarr\\bin',
    appData: 'C:\\ProgramData\\Sonarr',
  },
  data: {
    series: [{ id: 7, title: 'Example', path: 'P:\\TV\\Example' }],
    episodesBySeries: { '7': [{ id: 70 }] },
    episodeFilesBySeries: {
      '7': [{ id: 700, relativePath: 'Season 01\\episode.mkv' }],
    },
    rootFolders: [{ id: 1, path: 'P:\\TV' }],
    queue: [],
  },
  insights: {
    metrics: { seriesCount: 1, queueCount: 0, missingCount: 2, healthIssueCount: 0 },
    pipeline: { grabbed24h: 3, imported24h: 2, failed24h: 1 },
    collection: { endpointCount: 4, healthyEndpointCount: 4, failedEndpointCount: 0 },
  },
}

describe('Sonarr ingest', () => {
  it('authenticates, stores atomically, and acknowledges duplicate delivery ids', async () => {
    const handle = temporaryDatabase()
    const app = express()
      .use(express.json({ limit: '100mb' }))
      .use([
        '/api/sonarr/agent-check',
        '/api/sonarr/ingest',
        '/api/sonarr/agent-logs/ingest',
      ], requireSonarrAgent)
      .use(createSonarrRouter(handle.db))
    try {
      await withServer(app, async (url) => {
        const body = JSON.stringify({
          encoding: 'gzip-base64',
          payload: gzipSync(JSON.stringify(snapshot)).toString('base64'),
        })
        const send = (token = 'sonarr-test-token') => fetch(`${url}/api/sonarr/ingest`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Marquee-Delivery-Id': 'delivery-1',
            'Content-Type': 'application/json',
          },
          body,
        })
        expect((await send('wrong')).status).toBe(401)
        const first = await send()
        expect(first.status).toBe(200)
        expect((await first.json() as { duplicate: boolean }).duplicate).toBe(false)
        const duplicate = await send()
        expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true)
        expect((handle.db.prepare('SELECT COUNT(*) AS n FROM sonarr_ingest_receipts').get() as any).n).toBe(1)
        expect((handle.db.prepare('SELECT COUNT(*) AS n FROM sonarr_metric_samples').get() as any).n).toBe(1)
        const stored = handle.db.prepare(
          'SELECT payload FROM sonarr_latest WHERE id = 1',
        ).get() as { payload: Buffer }
        const storedSnapshot = unpackJson(stored.payload)
        expect(JSON.stringify(storedSnapshot)).not.toContain('P:\\\\TV')
        expect(JSON.stringify(storedSnapshot)).not.toContain('ProgramData')

        const dashboard = await fetch(`${url}/api/sonarr/dashboard`)
        const data = await dashboard.json() as any
        expect(data.snapshot.data.episodesBySeries).toBeUndefined()
        expect(JSON.stringify(data)).not.toContain('P:\\\\TV')
        const series = await fetch(`${url}/api/sonarr/series/7`)
        const detail = await series.json() as any
        expect(detail.episodes).toHaveLength(1)
        expect(JSON.stringify(detail)).not.toContain('relativePath')
        const exported = await fetch(`${url}/api/sonarr/export`)
        const exportedJson = JSON.stringify(await exported.json())
        expect(exportedJson).not.toContain('P:\\\\TV')
        expect(exportedJson).not.toContain('ProgramData')
      })
    } finally {
      handle.cleanup()
    }
  })

  it('rejects malformed and out-of-window snapshots', async () => {
    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createSonarrRouter(handle.db))
    try {
      await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/sonarr/ingest`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer sonarr-test-token',
            'Content-Type': 'application/json',
            'X-Marquee-Delivery-Id': 'malformed-delivery-1',
          },
          body: JSON.stringify({ encoding: 'plain', payload: '{}' }),
        })

        expect(response.status).toBe(400)
      })
    } finally {
      handle.cleanup()
    }
  })

  it('rejects a snapshot without a valid delivery id before writing', async () => {
    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createSonarrRouter(handle.db))
    try {
      await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/sonarr/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encoding: 'gzip-base64',
            payload: gzipSync(JSON.stringify(snapshot)).toString('base64'),
          }),
        })
        expect(response.status).toBe(400)
        expect((handle.db.prepare('SELECT COUNT(*) AS n FROM sonarr_latest').get() as any).n).toBe(0)
      })
    } finally {
      handle.cleanup()
    }
  })

  it('stores the agent delivery lines field and rejects missing log arrays', async () => {
    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createSonarrRouter(handle.db))
    try {
      await withServer(app, async (url) => {
        const headers = {
          Authorization: 'Bearer sonarr-test-token',
          'Content-Type': 'application/json',
          'X-Marquee-Delivery-Id': 'log-delivery-1',
        }
        const accepted = await fetch(`${url}/api/sonarr/agent-logs/ingest`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: 'sonarr',
            lines: [
              { ts: 1, level: 'info', message: 'collected' },
              { ts: 2, level: 'error', message: 'Failed C:\\ProgramData\\Sonarr\\config.xml' },
            ],
          }),
        })
        expect(accepted.status).toBe(200)
        expect((await accepted.json() as { stored: number }).stored).toBe(2)
        const missing = await fetch(`${url}/api/sonarr/agent-logs/ingest`, {
          method: 'POST',
          headers: { ...headers, 'X-Marquee-Delivery-Id': 'log-delivery-2' },
          body: JSON.stringify({ agent: 'sonarr' }),
        })
        expect(missing.status).toBe(400)
        const missingDeliveryId = await fetch(`${url}/api/sonarr/agent-logs/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: 'sonarr',
            lines: [{ ts: 2, level: 'info', message: 'must not store' }],
          }),
        })
        expect(missingDeliveryId.status).toBe(400)
        expect((handle.db.prepare('SELECT COUNT(*) AS n FROM sonarr_agent_logs').get() as any).n).toBe(2)
        expect((handle.db.prepare(
          "SELECT message FROM sonarr_agent_logs WHERE level = 'error'",
        ).get() as any).message).toBe('[redacted filesystem path]')
      })
    } finally {
      handle.cleanup()
    }
  })
})
