import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Router } from 'express'
import { requireWorkload } from '../auth/serviceTokens.js'
import { plexFetch, plexJson } from '../clients/plex.js'
import { SOURCE } from '../../lib/health/buildIdentity.js'
import { SCHEMA_VERSION } from '../../lib/db/migrate.js'
import {
  cancelResponseBody,
  readBoundedResponseBody,
} from '../domain/media/boundedBody.js'
import {
  canonicalPlexId,
  requireCanonicalPlexId,
} from '../domain/media/plexId.js'
import { config } from '../config.js'
import { plexTlsMode } from '../domain/media/plexTls.js'

interface MutationPayload {
  title: string
  sectionId: string
  ratingKeys: string[]
  summary?: string
}

const canonical = (value: unknown) => JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')

export function sonarrCollectionStatus(summary: any): 'healthy' | 'degraded' | 'unavailable' {
  const collection = summary?.collection ?? {}
  const failed = Number(collection.failedEndpointCount) || 0
  const healthy = Number(collection.healthyEndpointCount) || 0
  if (healthy === 0 && failed === 0) return 'unavailable'
  if (failed > 0 && healthy === 0) return 'unavailable'
  if (failed > 0) return 'degraded'
  return 'healthy'
}

export function createContractsV1Router(db: Database.Database) {
  const router = Router()
  const artworkReferences = new Map<string, { plexPath: string; expiresAt: number }>()
  const issueArtworkReference = (plexPath: string) => {
    const now = Date.now()
    for (const [id, reference] of artworkReferences) {
      if (reference.expiresAt <= now) artworkReferences.delete(id)
    }
    while (artworkReferences.size >= 5_000) {
      const oldest = artworkReferences.keys().next().value as string | undefined
      if (!oldest) break
      artworkReferences.delete(oldest)
    }
    const id = randomUUID()
    artworkReferences.set(id, { plexPath, expiresAt: now + 5 * 60_000 })
    return id
  }
  db.prepare(`
    UPDATE contract_mutation_intents
    SET status = 'unknown',
        error_message = COALESCE(
          error_message,
          'Recovered an executing intent after process restart'
        )
    WHERE status = 'executing'
  `).run()

  router.get('/api/contracts/v1/media-health', requireWorkload('watchtower', 'read'), (_req, res) => {
    const providers = db.prepare(
      'SELECT provider, observed_at, status, latency_ms, sanitized_error FROM provider_health ORDER BY provider',
    ).all()
    const sonarr = db.prepare(
      'SELECT sampled_at, received_at, poll_minutes, payload FROM sonarr_summary WHERE id = 1',
    ).get() as any
    const duplicate = db.prepare(`
      SELECT
        MAX(CASE WHEN action = 'scan' AND status = 'success' THEN ts END) AS last_scan_at,
        MAX(CASE WHEN action = 'delete' THEN ts END) AS last_delete_at,
        SUM(CASE WHEN action = 'delete' AND status = 'success' THEN 1 ELSE 0 END) AS delete_count,
        COALESCE(SUM(CASE WHEN action = 'delete' AND status = 'success' THEN file_size ELSE 0 END), 0) AS bytes_saved
      FROM plex_action_log
    `).get() as any
    const sonarrSummary = sonarr ? JSON.parse(sonarr.payload) : null
    const sonarrStatus = sonarrCollectionStatus(sonarrSummary)
    const stale = sonarr
      ? Date.now() - sonarr.received_at > Math.max(10 * 60_000, sonarr.poll_minutes * 180_000)
      : true
    const providerError = (providers as any[]).some((provider) => provider.status === 'error')
    const plexTransport = plexTlsMode(config.plex.baseUrl, config.plex.tls)
    res.json({
      schema: 'marquee.media-health.v1',
      generatedAt: new Date().toISOString(),
      source: SOURCE,
      status: !sonarr || sonarrStatus === 'unavailable' ? 'unavailable'
        : stale || providerError || plexTransport.degraded || sonarrStatus === 'degraded'
          ? 'degraded' : 'healthy',
      database: { ready: true, schemaVersion: SCHEMA_VERSION },
      providers,
      transport: { plex: plexTransport },
      sonarr: sonarr ? {
        present: true,
        stale,
        sampledAt: sonarr.sampled_at,
        receivedAt: sonarr.received_at,
        expectedCadenceSeconds: sonarr.poll_minutes * 60,
        status: sonarrStatus,
        ...sonarrSummary,
      } : { present: false, stale: true },
      duplicates: {
        lastScanAt: duplicate.last_scan_at,
        lastDeleteAt: duplicate.last_delete_at,
        successfulDeletes: Number(duplicate.delete_count) || 0,
        bytesSaved: Number(duplicate.bytes_saved) || 0,
      },
    })
  })

  router.get('/api/contracts/v1/media/search', requireWorkload('prism', 'read'), async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q || q.length > 200) return res.status(400).json({ error: { code: 'INVALID_QUERY' } })
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    const types = new Set(
      String(req.query.types || 'movie,show').split(',').filter((value) => ['movie', 'show'].includes(value)),
    )
    const requestedSections = String(req.query.sectionIds || '').split(',').filter(Boolean)
    if (requestedSections.some((id) => !canonicalPlexId(id))) {
      return res.status(400).json({ error: { code: 'INVALID_SECTION_ID' } })
    }
    const allowedSections = new Set(requestedSections)
    try {
      const sections = await plexJson<any>('/library/sections')
      const selected = (sections.MediaContainer?.Directory ?? []).filter((section: any) => (
        canonicalPlexId(String(section.key))
        && types.has(section.type)
        && (!allowedSections.size || allowedSections.has(String(section.key)))
      ))
      const items: any[] = []
      for (const section of selected) {
        const sectionId = requireCanonicalPlexId(String(section.key), 'Plex section id')
        const result = await plexJson<any>(
          `/library/sections/${sectionId}/search?query=${encodeURIComponent(q)}`,
        )
        for (const media of result.MediaContainer?.Metadata ?? []) {
          if (items.length >= limit) break
          const mediaId = canonicalPlexId(String(media.ratingKey))
          if (!mediaId) continue
          items.push({
            id: mediaId,
            type: media.type,
            title: media.title,
            year: media.year ?? null,
            library: { id: sectionId, name: section.title },
            durationMs: Number(media.duration) || null,
            summary: media.summary || null,
            artwork: media.thumb ? {
              href: `/api/contracts/v1/media/artwork/${issueArtworkReference(String(media.thumb))}`,
              expiresInSeconds: 300,
            } : null,
          })

        }
        if (items.length >= limit) break
      }
      res.json({ schema: 'marquee.media-search.v1', query: q, count: items.length, items })
    } catch {
      res.status(502).json({ error: { code: 'PLEX_SEARCH_FAILED' } })
    }
  })

  router.get(
    '/api/contracts/v1/media/artwork/:reference',
    requireWorkload('prism', 'read'),
    async (req, res) => {
      const reference = artworkReferences.get(String(req.params.reference))
      if (!reference || reference.expiresAt <= Date.now()) {
        if (reference) artworkReferences.delete(String(req.params.reference))
        return res.status(404).json({ error: { code: 'ARTWORK_REFERENCE_NOT_FOUND' } })
      }
      try {
        const upstream = await plexFetch(reference.plexPath, { accept: 'image' })
        if (!upstream.ok) {
          await cancelResponseBody(upstream)
          return res.status(502).json({ error: { code: 'ARTWORK_FETCH_FAILED' } })
        }
        const contentType = upstream.headers.get('content-type') || ''
        if (!contentType.startsWith('image/')) {
          await cancelResponseBody(upstream)
          return res.status(502).json({ error: { code: 'ARTWORK_CONTENT_TYPE_INVALID' } })
        }
        const declaredLength = Number(upstream.headers.get('content-length')) || 0
        if (declaredLength > 10 * 1024 * 1024) {
          await cancelResponseBody(upstream)
          return res.status(413).json({ error: { code: 'ARTWORK_TOO_LARGE' } })
        }
        let bytes: Buffer
        try {
          bytes = await readBoundedResponseBody(upstream, 10 * 1024 * 1024)
        } catch (error) {
          if (error instanceof Error && error.message === 'RESPONSE_BODY_TOO_LARGE') {
            return res.status(413).json({ error: { code: 'ARTWORK_TOO_LARGE' } })
          }
          throw error
        }
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'private, max-age=300')
        return res.send(bytes)
      } catch {
        return res.status(502).json({ error: { code: 'ARTWORK_FETCH_FAILED' } })
      }
    },
  )

  const prepare = (operation: 'playlist' | 'collection') => async (req: any, res: any) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const sectionId = canonicalPlexId(String(req.body?.sectionId || ''))
    const rawRatingKeys: string[] = Array.isArray(req.body?.ratingKeys)
      ? [...new Set<string>(req.body.ratingKeys.map(String))].slice(0, 250)
      : []
    const ratingKeys = rawRatingKeys.map((id) => canonicalPlexId(id))
    if (!title || title.length > 120 || !sectionId || !ratingKeys.length) {
      return res.status(400).json({ error: { code: 'INVALID_MUTATION' } })
    }
    if (ratingKeys.some((id) => !id)) {
      return res.status(400).json({ error: { code: 'INVALID_MEDIA_ID' } })
    }
    const canonicalRatingKeys = ratingKeys as string[]
    try {
      const metadata = await Promise.all(canonicalRatingKeys.map(async (ratingKey) => {
        const result = await plexJson<any>(`/library/metadata/${ratingKey}`)
        const item = result.MediaContainer?.Metadata?.[0]
        if (!item || String(item.librarySectionID) !== sectionId) {
          throw new Error('Media item is not in the requested section')
        }
        return { ratingKey, title: item.title, year: item.year ?? null }
      }))
      const payload: MutationPayload = {
        title,
        sectionId,
        ratingKeys: canonicalRatingKeys,
        ...(typeof req.body?.summary === 'string' ? { summary: req.body.summary.slice(0, 2_000) } : {}),
      }
      const id = randomUUID()
      const phrase = `CREATE ${operation.toUpperCase()} "${title}" WITH ${canonicalRatingKeys.length} ITEMS`
      const now = Date.now()
      db.prepare(`
        INSERT INTO contract_mutation_intents(
          id, consumer, operation, payload_hash, payload_json, confirmation_phrase,
          status, created_at, expires_at
        ) VALUES (?, 'prism', ?, ?, ?, ?, 'prepared', ?, ?)
      `).run(id, operation, hash(payload), canonical(payload), phrase, now, now + 5 * 60_000)
      return res.json({
        schema: `marquee.${operation}-mutation.v1`,
        intentId: id,
        expiresAt: new Date(now + 5 * 60_000).toISOString(),
        confirmationPhrase: phrase,
        preview: { ...payload, items: metadata },
      })
    } catch {
      return res.status(409).json({ error: { code: 'MEDIA_VERIFICATION_FAILED' } })
    }
  }

  const commit = (operation: 'playlist' | 'collection') => async (req: any, res: any) => {
    const intentId = String(req.body?.intentId || '')
    const confirmation = String(req.body?.confirmation || '')
    const idempotencyKey = String(req.get('idempotency-key') || '')
    if (!intentId || !confirmation || !idempotencyKey || idempotencyKey.length > 200) {
      return res.status(400).json({ error: { code: 'CONFIRMATION_REQUIRED' } })
    }
    const intent = db.prepare(
      'SELECT * FROM contract_mutation_intents WHERE id = ? AND consumer = ? AND operation = ?',
    ).get(intentId, 'prism', operation) as any
    if (!intent) return res.status(404).json({ error: { code: 'INTENT_NOT_FOUND' } })
    if (intent.idempotency_key && intent.idempotency_key !== idempotencyKey) {
      return res.status(409).json({ error: { code: 'IDEMPOTENCY_KEY_MISMATCH' } })
    }
    if (['succeeded', 'failed', 'unknown'].includes(intent.status)) {
      return res.status(intent.status === 'succeeded' ? 200 : 409)
        .json(intent.result_json ? JSON.parse(intent.result_json) : {
          error: { code: intent.status === 'unknown' ? 'OUTCOME_UNKNOWN' : 'MUTATION_FAILED' },
        })
    }
    if (intent.status === 'executing') {
      db.prepare(`
        UPDATE contract_mutation_intents
        SET status = 'unknown',
            error_message = 'Recovered an executing intent after an interrupted request'
        WHERE id = ? AND status = 'executing'
      `).run(intentId)
      return res.status(409).json({ error: { code: 'OUTCOME_UNKNOWN' }, intentId })
    }
    if (intent.expires_at < Date.now()) {
      db.prepare("UPDATE contract_mutation_intents SET status = 'expired' WHERE id = ?").run(intentId)
      return res.status(410).json({ error: { code: 'INTENT_EXPIRED' } })
    }
    if (confirmation !== intent.confirmation_phrase) {
      return res.status(400).json({ error: { code: 'CONFIRMATION_MISMATCH' } })
    }
    const claimed = db.prepare(`
      UPDATE contract_mutation_intents
      SET status = 'executing', idempotency_key = ?
      WHERE id = ? AND status = 'prepared'
    `).run(idempotencyKey, intentId)
    if (claimed.changes !== 1) {
      return res.status(409).json({ error: { code: 'INTENT_ALREADY_CLAIMED' } })
    }

    const payload = JSON.parse(intent.payload_json) as MutationPayload
    try {
      const sectionId = requireCanonicalPlexId(payload.sectionId, 'stored section id')
      const ratingKeys = payload.ratingKeys.map(
        (id) => requireCanonicalPlexId(id, 'stored media id'),
      )
      const root = await plexJson<any>('/')
      const machineId = root.MediaContainer?.machineIdentifier
      if (!machineId) throw new Error('Missing Plex machine identifier')
      const uri = (key: string) => `library://${machineId}/item/library/metadata/${key}`
      const first = ratingKeys[0]
      if (!first) throw new Error('Mutation has no media items')
      const createPath = operation === 'playlist'
        ? `/playlists?type=video&title=${encodeURIComponent(payload.title)}&smart=0&uri=${encodeURIComponent(uri(first))}`
        : `/library/sections/${sectionId}/collections?type=movie&title=${encodeURIComponent(payload.title)}&uri=${encodeURIComponent(uri(first))}`
      const response = await plexFetch(createPath, { method: 'POST', accept: 'xml' })
      if (!response.ok) throw new Error(`Plex create returned ${response.status}`)
      const text = await response.text()
      const id = text.match(/ratingKey="(\d+)"/)?.[1]
      if (!id) throw new Error('Plex did not return the new object id')
      for (const key of ratingKeys.slice(1)) {
        const path = operation === 'playlist'
          ? `/playlists/${id}/items?uri=${encodeURIComponent(uri(key))}`
          : `/library/collections/${id}/items?uri=${encodeURIComponent(uri(key))}`
        const add = await plexFetch(path, { method: 'PUT' })
        if (!add.ok) throw new Error(`Plex add returned ${add.status}`)
      }
      const result = {
        schema: `marquee.${operation}-mutation.v1`,
        success: true,
        intentId,
        id,
        title: payload.title,
        itemCount: ratingKeys.length,
      }
      db.prepare(`
        UPDATE contract_mutation_intents SET status = 'succeeded', result_json = ? WHERE id = ?
      `).run(JSON.stringify(result), intentId)
      return res.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'Mutation failed'
      db.prepare(`
        UPDATE contract_mutation_intents
        SET status = 'unknown', error_message = ? WHERE id = ?
      `).run(message, intentId)
      return res.status(409).json({ error: { code: 'OUTCOME_UNKNOWN' }, intentId })
    }
  }

  router.post('/api/contracts/v1/playlists/prepare', requireWorkload('prism', 'write'), prepare('playlist'))
  router.post('/api/contracts/v1/playlists/commit', requireWorkload('prism', 'write'), commit('playlist'))
  router.post('/api/contracts/v1/collections/prepare', requireWorkload('prism', 'write'), prepare('collection'))
  router.post('/api/contracts/v1/collections/commit', requireWorkload('prism', 'write'), commit('collection'))

  return router
}
