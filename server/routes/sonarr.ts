import { gunzipSync } from 'node:zlib'
import type Database from 'better-sqlite3'
import { Router } from 'express'
import { packJson, unpackJson } from '../domain/sonarr/codec.js'
import {
  redactAbsoluteFilesystemString,
  sanitizeSonarrData,
} from '../domain/sonarr/sanitize.js'

const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 96 * 1024 * 1024
const METRIC_INTERVAL_MS = 15 * 60 * 1000
const METRIC_RETENTION_MS = 365 * 24 * 60 * 60 * 1000
const RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
const DELIVERY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
let lastPruneAt = 0

const integer = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function decodeSnapshot(body: any) {
  if (!body || body.encoding !== 'gzip-base64' || typeof body.payload !== 'string') {
    throw new Error('Body must contain a gzip-base64 snapshot payload')
  }
  const maxBase64Length = Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4 + 4
  if (body.payload.length > maxBase64Length) {
    throw new Error('Compressed snapshot is too large')
  }
  const compressed = Buffer.from(body.payload, 'base64')
  if (!compressed.length || compressed.length > MAX_COMPRESSED_BYTES) {
    throw new Error('Compressed snapshot is empty or too large')
  }
  const raw = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES })
  const snapshot = JSON.parse(raw.toString('utf8'))
  if (
    !snapshot || snapshot.schema !== 1 || !Number.isFinite(Number(snapshot.sampled_at))
    || !snapshot.data || typeof snapshot.data !== 'object'
    || !snapshot.insights || typeof snapshot.insights !== 'object'
  ) {
    throw new Error('Snapshot schema is invalid')
  }
  return snapshot
}

const summaryPayload = (snapshot: any) => {
  const metrics = snapshot.insights?.metrics ?? {}
  const pipeline = snapshot.insights?.pipeline ?? {}
  const collection = snapshot.insights?.collection ?? {}
  return {
    metrics: {
      seriesCount: integer(metrics.seriesCount) ?? 0,
      queueCount: integer(metrics.queueCount) ?? 0,
      missingCount: integer(metrics.missingCount) ?? 0,
      healthIssueCount: integer(metrics.healthIssueCount) ?? 0,
    },
    pipeline: {
      grabbed24h: integer(pipeline.grabbed24h) ?? 0,
      imported24h: integer(pipeline.imported24h) ?? 0,
      failed24h: integer(pipeline.failed24h) ?? 0,
    },
    collection: {
      endpointCount: integer(collection.endpointCount) ?? 0,
      healthyEndpointCount: integer(collection.healthyEndpointCount) ?? 0,
      failedEndpointCount: integer(collection.failedEndpointCount) ?? 0,
    },
  }
}

const freshness = (row: any, pollMinutesValue: unknown) => {
  const cadenceMs = Math.max(1, Number(pollMinutesValue) || 2) * 60_000
  const staleAfterMs = Math.max(10 * 60_000, cadenceMs * 3)
  const ageMs = Math.max(0, Date.now() - Number(row.received_at))
  return {
    received_at: row.received_at,
    age_seconds: Math.round(ageMs / 1_000),
    stale: ageMs > staleAfterMs,
    last_contact_at: row.received_at,
    source_observed_at: row.sampled_at ?? null,
    expected_cadence_seconds: Math.round(cadenceMs / 1_000),
    stale_after_seconds: Math.round(staleAfterMs / 1_000),
  }
}

export function createSonarrRouter(db: Database.Database) {
  const router = Router()
  const upsertLatest = db.prepare(`
    INSERT INTO sonarr_latest(id, sampled_at, received_at, payload)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sampled_at = excluded.sampled_at,
      received_at = excluded.received_at,
      payload = excluded.payload
    WHERE excluded.sampled_at >= sonarr_latest.sampled_at
  `)
  const upsertSummary = db.prepare(`
    INSERT INTO sonarr_summary(id, sampled_at, received_at, poll_minutes, payload)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sampled_at = excluded.sampled_at,
      received_at = excluded.received_at,
      poll_minutes = excluded.poll_minutes,
      payload = excluded.payload
    WHERE excluded.sampled_at >= sonarr_summary.sampled_at
  `)
  const insertReceipt = db.prepare(`
    INSERT OR IGNORE INTO sonarr_ingest_receipts(delivery_id, endpoint, received_at)
    VALUES (?, ?, ?)
  `)

  const deliveryId = (req: any) => {
    const value = String(
      req.get('x-marquee-delivery-id')
      ?? req.get('x-hearth-delivery-id')
      ?? req.body?.delivery_id
      ?? '',
    ).trim()
    return DELIVERY_ID.test(value) ? value : null
  }

  const ingest = db.transaction((snapshot: any, now: number, id: string | null) => {
    if (id && insertReceipt.run(id, '/api/sonarr/ingest', now).changes === 0) return false
    const sampledAt = Math.round(Number(snapshot.sampled_at))
    upsertLatest.run(sampledAt, now, packJson(snapshot))
    const pollMinutes = Math.max(1, integer(snapshot.agent?.poll_minutes) || 2)
    upsertSummary.run(sampledAt, now, pollMinutes, JSON.stringify(summaryPayload(snapshot)))
    const latest = db.prepare(
      'SELECT sampled_at FROM sonarr_metric_samples ORDER BY sampled_at DESC LIMIT 1',
    ).get() as { sampled_at: number } | undefined
    if (sampledAt - (latest?.sampled_at ?? 0) >= METRIC_INTERVAL_MS) {
      const metrics = snapshot.insights?.metrics ?? {}
      db.prepare(`
        INSERT OR IGNORE INTO sonarr_metric_samples(
          sampled_at, received_at, series_count, monitored_series_count,
          episode_count, episode_file_count, monitored_episode_count,
          missing_count, cutoff_unmet_count, queue_count, health_issue_count,
          library_size_bytes, free_space_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sampledAt, now, integer(metrics.seriesCount), integer(metrics.monitoredSeriesCount),
        integer(metrics.episodeCount), integer(metrics.episodeFileCount),
        integer(metrics.monitoredEpisodeCount), integer(metrics.missingCount),
        integer(metrics.cutoffUnmetCount), integer(metrics.queueCount),
        integer(metrics.healthIssueCount), integer(metrics.librarySizeBytes),
        integer(metrics.freeSpaceBytes),
      )
    }
    if (now - lastPruneAt >= PRUNE_INTERVAL_MS) {
      db.prepare('DELETE FROM sonarr_metric_samples WHERE sampled_at < ?')
        .run(now - METRIC_RETENTION_MS)
      db.prepare('DELETE FROM sonarr_ingest_receipts WHERE received_at < ?')
        .run(now - RECEIPT_RETENTION_MS)
      lastPruneAt = now
    }
    return true
  })

  router.get('/api/sonarr/agent-check', (_req, res) => res.json({ ok: true }))

  router.post('/api/sonarr/ingest', (req, res) => {
    try {
      const id = deliveryId(req)
      if (!id) return res.status(400).json({ error: 'A valid delivery id is required' })
      const snapshot = sanitizeSonarrData(decodeSnapshot(req.body)) as any
      const now = Date.now()
      const sampledAt = Number(snapshot.sampled_at)
      if (sampledAt > now + 86_400_000 || sampledAt < now - 7 * 86_400_000) {
        return res.status(400).json({ error: 'Snapshot timestamp is outside the accepted window' })
      }
      const stored = ingest(snapshot, now, id)
      return res.json({ ok: true, duplicate: !stored, sampled_at: Math.round(sampledAt), received_at: now })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/sonarr/agent-logs/ingest', (req, res) => {
    const incoming = Array.isArray(req.body?.lines)
      ? req.body.lines
      : Array.isArray(req.body?.logs) ? req.body.logs : null
    if (!incoming) return res.status(400).json({ error: 'Agent log lines array is required' })
    const rows = incoming.slice(0, 500)
    const now = Date.now()
    const id = deliveryId(req)
    if (!id) return res.status(400).json({ error: 'A valid delivery id is required' })
    const insertLogs = db.transaction(() => {
      if (id && insertReceipt.run(id, '/api/sonarr/agent-logs/ingest', now).changes === 0) return false
      const insert = db.prepare(`
        INSERT INTO sonarr_agent_logs(ts, level, message, received_at) VALUES (?, ?, ?, ?)
      `)
      for (const row of rows) {
        insert.run(
          integer(row?.ts) ?? now,
          String(row?.level || 'info').slice(0, 16),
          redactAbsoluteFilesystemString(String(row?.message || '')).slice(0, 4_000),
          now,
        )
      }
      return true
    })
    try {
      const stored = insertLogs()
      res.json({ ok: true, duplicate: !stored, stored: stored ? rows.length : 0 })
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  const latest = () => {
    const row = db.prepare(
      'SELECT sampled_at, received_at, payload FROM sonarr_latest WHERE id = 1',
    ).get() as any
    if (!row) return null
    const snapshot = unpackJson(row.payload)
    return snapshot ? { row, snapshot } : null
  }

  router.get('/api/sonarr/summary', (_req, res) => {
    res.set('Cache-Control', 'no-store')
    let row = db.prepare(
      'SELECT sampled_at, received_at, poll_minutes, payload FROM sonarr_summary WHERE id = 1',
    ).get() as any
    if (!row) {
      const current = latest()
      if (!current) return res.json({ ok: true, present: false })
      const pollMinutes = Math.max(1, integer(current.snapshot.agent?.poll_minutes) || 2)
      upsertSummary.run(
        current.row.sampled_at,
        current.row.received_at,
        pollMinutes,
        JSON.stringify(summaryPayload(current.snapshot)),
      )
      row = db.prepare(
        'SELECT sampled_at, received_at, poll_minutes, payload FROM sonarr_summary WHERE id = 1',
      ).get() as any
    }
    res.json({
      ok: true, present: true, sampled_at: row.sampled_at,
      ...freshness(row, row.poll_minutes), ...JSON.parse(row.payload),
    })
  })

  router.get('/api/sonarr/dashboard', (_req, res) => {
    res.set('Cache-Control', 'no-store')
    const current = latest()
    if (!current) return res.json({ ok: true, present: false })
    const { episodesBySeries: _episodes, episodeFilesBySeries: _files, ...data } =
      current.snapshot.data ?? {}
    res.json({
      ok: true,
      present: true,
      ...freshness(current.row, current.snapshot.agent?.poll_minutes),
      snapshot: sanitizeSonarrData({
        ...current.snapshot,
        data: sanitizeSonarrData(data),
        detail: {
          episodeSeriesCount: Object.keys(current.snapshot.data?.episodesBySeries ?? {}).length,
          episodeFileSeriesCount: Object.keys(current.snapshot.data?.episodeFilesBySeries ?? {}).length,
        },
      }),
    })
  })

  router.get('/api/sonarr/series/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Series id must be a positive integer' })
    }
    const current = latest()
    if (!current) return res.status(404).json({ error: 'No Sonarr snapshot is available' })
    const series = (current.snapshot.data?.series ?? []).find((item: any) => Number(item?.id) === id)
    if (!series) return res.status(404).json({ error: 'Series not found in the latest snapshot' })
    res.json({
      ok: true,
      ...freshness(current.row, current.snapshot.agent?.poll_minutes),
      series: sanitizeSonarrData(series),
      episodes: sanitizeSonarrData(current.snapshot.data?.episodesBySeries?.[String(id)] ?? []),
      episodeFiles: sanitizeSonarrData(
        current.snapshot.data?.episodeFilesBySeries?.[String(id)] ?? [],
      ),
    })
  })

  router.get('/api/sonarr/trends', (req, res) => {
    const days = Math.max(1, Math.min(365, Math.floor(Number(req.query.days) || 180)))
    const points = db.prepare(`
      SELECT sampled_at, series_count, monitored_series_count, episode_count,
             episode_file_count, monitored_episode_count, missing_count,
             cutoff_unmet_count, queue_count, health_issue_count,
             library_size_bytes, free_space_bytes
      FROM sonarr_metric_samples WHERE sampled_at >= ? ORDER BY sampled_at ASC
    `).all(Date.now() - days * 86_400_000)
    res.json({ ok: true, days, points })
  })

  router.get('/api/sonarr/export', (_req, res) => {
    const current = latest()
    if (!current) return res.status(404).json({ error: 'No Sonarr snapshot is available' })
    res.json({
      ok: true,
      ...freshness(current.row, current.snapshot.agent?.poll_minutes),
      snapshot: sanitizeSonarrData(current.snapshot),
    })
  })

  return router
}
