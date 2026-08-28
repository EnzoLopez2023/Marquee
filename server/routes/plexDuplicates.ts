import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Router } from 'express'
import { plexFetch, plexJson } from '../clients/plex.js'
import {
  findMediaAndPart,
  groupDuplicates,
  detectThreeD,
  normalizeResolution,
  normalizeTitle,
} from '../domain/duplicates/grouping.js'
import { canonicalPlexId } from '../domain/media/plexId.js'

interface DeleteRequest {
  deleteRatingKey?: string
  expectedGuid?: string
  expectedTitle?: string
  expectedYear?: number | null
  expectedFilePath?: string
  expectedMediaId?: string | null
  expectedLibraryTitles?: string[]
  expectedRatingKeys?: string[]
  keeperRatingKey?: string
  keeperMediaId?: string | null
  keeperFilePath?: string | null
  expectedResolution?: string
  expectedIs3D?: boolean
  confirmToken?: string
}

const safeJson = (value: unknown) => {
  try { return JSON.stringify(value) } catch { return JSON.stringify({ serializationFailed: true }) }
}
const processDeleteLocks = new Set<string>()
const deleteLockOwner = randomUUID()

interface DeletionLeaseGuard {
  assert(): void
  onLost(listener: () => void): () => void
}

const noLeaseGuard: DeletionLeaseGuard = {
  assert: () => {},
  onLost: () => () => {},
}

export function createPlexDuplicatesRouter(
  db: Database.Database,
  leaseGuard: DeletionLeaseGuard = noLeaseGuard,
) {
  const router = Router()
  const insert = db.prepare(`
    INSERT INTO plex_action_log (
      correlation_id, ts, action, status, rating_key, library_id, library_title,
      movie_guid, title, year, file_path, file_size, duration_ms, bitrate_kbps,
      resolution, video_codec, audio_codec, audio_channels, container,
      kept_rating_key, kept_file_path, snapshot_json, error_message, user_email,
      tenant_id, user_oid
    ) VALUES (
      @correlation_id, @ts, @action, @status, @rating_key, @library_id, @library_title,
      @movie_guid, @title, @year, @file_path, @file_size, @duration_ms, @bitrate_kbps,
      @resolution, @video_codec, @audio_codec, @audio_channels, @container,
      @kept_rating_key, @kept_file_path, @snapshot_json, @error_message, @user_email,
      @tenant_id, @user_oid
    )
  `)
  const audit = (row: Record<string, unknown>) => insert.run({
    correlation_id: row.correlation_id ?? null,
    ts: row.ts ?? Date.now(),
    action: row.action,
    status: row.status,
    rating_key: row.rating_key ?? null,
    library_id: row.library_id ?? null,
    library_title: row.library_title ?? null,
    movie_guid: row.movie_guid ?? null,
    title: row.title ?? null,
    year: row.year ?? null,
    file_path: row.file_path ?? null,
    file_size: row.file_size ?? null,
    duration_ms: row.duration_ms ?? null,
    bitrate_kbps: row.bitrate_kbps ?? null,
    resolution: row.resolution ?? null,
    video_codec: row.video_codec ?? null,
    audio_codec: row.audio_codec ?? null,
    audio_channels: row.audio_channels ?? null,
    container: row.container ?? null,
    kept_rating_key: row.kept_rating_key ?? null,
    kept_file_path: row.kept_file_path ?? null,
    snapshot_json: row.snapshot_json ?? null,
    error_message: row.error_message ?? null,
    user_email: row.user_email ?? null,
    tenant_id: row.tenant_id ?? null,
    user_oid: row.user_oid ?? null,
  })
  const acquireDatabaseLock = db.prepare(`
    INSERT INTO plex_delete_locks(lock_key, owner_id, acquired_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(lock_key) DO UPDATE SET
      owner_id = excluded.owner_id,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
    WHERE plex_delete_locks.expires_at < excluded.acquired_at
  `)
  const releaseDatabaseLock = db.prepare(`
    DELETE FROM plex_delete_locks WHERE lock_key = ? AND owner_id = ?
  `)
  const acquireDeleteLock = (lockKey: string) => {
    if (processDeleteLocks.has(lockKey)) return null
    processDeleteLocks.add(lockKey)
    const now = Date.now()
    try {
      if (
        acquireDatabaseLock.run(
          lockKey,
          deleteLockOwner,
          now,
          now + 5 * 60_000,
        ).changes !== 1
      ) {
        processDeleteLocks.delete(lockKey)
        return null
      }
    } catch (error) {
      processDeleteLocks.delete(lockKey)
      throw error
    }
    let released = false
    return (preserveDatabaseLock = false) => {
      if (released) return
      released = true
      try {
        if (!preserveDatabaseLock) {
          releaseDatabaseLock.run(lockKey, deleteLockOwner)
        }
      } finally {
        processDeleteLocks.delete(lockKey)
      }
    }
  }

  router.get('/api/plex/duplicates/server-config', async (_req, res) => {
    try {
      const root = await plexJson<any>('/')
      const container = root.MediaContainer || {}
      res.json({
        allowMediaDeletion: Boolean(container.allowMediaDeletion),
        serverName: container.friendlyName || null,
        machineId: container.machineIdentifier || null,
        version: container.version || null,
      })
    } catch (error) {
      console.error('Plex server-config error:', error)
      res.status(502).json({ error: 'Failed to read Plex server config' })
    }
  })

  router.get('/api/plex/duplicates/scan', async (_req, res) => {
    try {
      const sections = await plexJson<any>('/library/sections')
      const movieSections: any[] = (sections.MediaContainer?.Directory || [])
        .filter((section: any) => section.type === 'movie')
      const sectionResults = await Promise.all(movieSections.map(async (section) => {
        try {
          const sectionId = canonicalPlexId(String(section.key))
          if (!sectionId) return { section, metadata: [] }
          const data = await plexJson<any>(
            `/library/sections/${sectionId}/all?includeGuids=1`,
          )
          return { section, metadata: data.MediaContainer?.Metadata || [] }
        } catch (error) {
          console.error(`Duplicate scan section ${section.key} failed:`, error)
          return { section, metadata: [] }
        }
      }))
      const result = groupDuplicates(sectionResults)
      const scannedAt = Date.now()
      audit({
        action: 'scan',
        status: 'success',
        ts: scannedAt,
        snapshot_json: safeJson({
          ...result,
          groups: undefined,
          unmatchedGroups: undefined,
          librariesScanned: movieSections.map(({ key, title }) => ({ key, title })),
        }),
      })
      res.json({ ...result, scannedAt })
    } catch (error) {
      console.error('Plex duplicate scan failed:', error)
      res.status(502).json({ error: 'Failed to scan Plex duplicates' })
    }
  })

  router.post('/api/plex/duplicates/delete', async (req, res) => {
    const body = (req.body || {}) as DeleteRequest
    const correlationId = randomUUID()
    const base = {
      correlation_id: correlationId,
      rating_key: body.deleteRatingKey || null,
      movie_guid: body.expectedGuid || null,
      title: body.expectedTitle || null,
      year: body.expectedYear ?? null,
      file_path: body.expectedFilePath || null,
      library_title: body.expectedLibraryTitles?.join(', ') || null,
      kept_rating_key: body.keeperRatingKey || null,
      kept_file_path: body.keeperFilePath || null,
      user_email: req.identity?.email ?? null,
      tenant_id: req.identity?.tenantId ?? null,
      user_oid: req.identity?.oid ?? null,
    }
    const requestSnapshot = safeJson({
      expected: {
        guid: body.expectedGuid,
        title: body.expectedTitle,
        year: body.expectedYear,
        filePath: body.expectedFilePath,
        mediaId: body.expectedMediaId,
        libraryTitles: body.expectedLibraryTitles,
        ratingKeys: body.expectedRatingKeys,
      },
      keeper: {
        ratingKey: body.keeperRatingKey,
        mediaId: body.keeperMediaId,
        filePath: body.keeperFilePath,
      },
      group: {
        resolution: body.expectedResolution,
        is3D: body.expectedIs3D,
      },
    })

    if (body.confirmToken !== 'DELETE') {
      audit({ ...base, action: 'delete_attempt', status: 'cancelled',
        snapshot_json: requestSnapshot, error_message: 'Missing or invalid confirmToken' })
      return res.status(400).json({ error: 'confirmToken must be the literal string "DELETE"' })
    }

    if (
      !body.deleteRatingKey || !body.expectedGuid || !body.expectedTitle
      || !body.expectedFilePath || !body.expectedMediaId || !body.keeperRatingKey
      || !body.keeperMediaId || !body.keeperFilePath
      || !body.expectedResolution || typeof body.expectedIs3D !== 'boolean'
    ) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: requestSnapshot, error_message: 'Missing required field in delete request' })
      return res.status(400).json({ error: 'Missing required field' })
    }
    const deleteRatingKey = canonicalPlexId(body.deleteRatingKey)
    const expectedMediaId = canonicalPlexId(body.expectedMediaId)
    const keeperRatingKey = canonicalPlexId(body.keeperRatingKey)
    const keeperMediaId = canonicalPlexId(body.keeperMediaId)
    if (!deleteRatingKey || !expectedMediaId || !keeperRatingKey || !keeperMediaId) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: requestSnapshot,
        error_message: 'Plex identifiers must be canonical positive integers' })
      return res.status(400).json({ error: 'Invalid Plex identifier' })
    }
    const expectedResolution = normalizeResolution(body.expectedResolution)
    const groupLockKey = [
      body.expectedGuid.trim().toLowerCase(),
      expectedResolution,
      body.expectedIs3D ? '3d' : '2d',
    ].join('|')
    const releaseDeleteLock = acquireDeleteLock(groupLockKey)
    if (!releaseDeleteLock) {
      audit({
        ...base,
        action: 'delete_attempt',
        status: 'verify_failed',
        snapshot_json: requestSnapshot,
        error_message: `Duplicate group is already being mutated: ${groupLockKey}`,
      })
      return res.status(409).json({
        error: 'This duplicate group already has a deletion in progress',
        code: 'DUPLICATE_GROUP_BUSY',
        retry: false,
        correlationId,
      })
    }
    const leaseAbort = new AbortController()
    const unsubscribeLeaseLoss = leaseGuard.onLost(() => {
      leaseAbort.abort(new Error('Runtime SQLite instance lease was lost'))
    })

    try {
    try {
      leaseGuard.assert()
    } catch {
      leaseAbort.abort(new Error('Runtime SQLite instance lease was lost'))
      audit({
        ...base,
        action: 'delete_attempt',
        status: 'verify_failed',
        snapshot_json: requestSnapshot,
        error_message: 'Runtime SQLite instance lease was lost before verification',
      })
      return res.status(503).json({
        error: 'Deletion fenced because this process lost the database instance lease',
        code: 'INSTANCE_LEASE_LOST',
        retry: false,
        correlationId,
      })
    }
    const keeperEquivalent = (
      keeperRatingKey === deleteRatingKey
      && keeperMediaId === expectedMediaId
    ) || body.keeperFilePath.trim().toLowerCase() === body.expectedFilePath.trim().toLowerCase()
    if (keeperEquivalent) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: requestSnapshot,
        error_message: 'Keeper must identify a distinct physical Media and Part' })
      return res.status(409).json({ error: 'Keeper is the same physical copy as the delete target' })
    }

    let targetMetadata: any
    try {
      const data = await plexJson<any>(
        `/library/metadata/${deleteRatingKey}`,
        { signal: leaseAbort.signal },
      )
      targetMetadata = data.MediaContainer?.Metadata?.[0]
    } catch (error) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: requestSnapshot,
        error_message: `Could not re-fetch delete target: ${error instanceof Error ? error.message : String(error)}` })
      return res.status(409).json({ error: 'Could not verify delete target on Plex' })
    }
    if (!targetMetadata) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: requestSnapshot, error_message: 'Delete target metadata not found on Plex' })
      return res.status(409).json({ error: 'Delete target no longer exists on Plex' })
    }

    const { media: targetMedia, part: targetPart } = findMediaAndPart(
      targetMetadata,
      expectedMediaId,
      body.expectedFilePath,
    )
    const checks = {
      guidOk: targetMetadata.guid === body.expectedGuid,
      titleOk: normalizeTitle(targetMetadata.title) === normalizeTitle(body.expectedTitle),
      yearOk: !body.expectedYear || Number(targetMetadata.year) === Number(body.expectedYear),
      fileOk: targetPart?.file === body.expectedFilePath,
      mediaOk: String(targetMedia?.id) === expectedMediaId,
      atomicMediaOk: (targetMedia?.Part?.length ?? 0) === 1,
      resolutionOk: normalizeResolution(targetMedia?.videoResolution) === expectedResolution,
      editionOk: detectThreeD(targetPart?.file) === body.expectedIs3D,
    }
    if (Object.values(checks).some((value) => !value)) {
      audit({
        ...base,
        action: 'delete_attempt',
        status: 'verify_failed',
        snapshot_json: safeJson({
          request: JSON.parse(requestSnapshot),
          checks,
          actual: {
            guid: targetMetadata.guid,
            title: targetMetadata.title,
            year: targetMetadata.year,
            filePath: targetPart?.file,
            mediaId: targetMedia?.id,
          },
        }),
        error_message: `Identity mismatch: ${Object.entries(checks).map(([key, value]) => `${key}=${value}`).join(' ')}`,
      })
      return res.status(409).json({
        error: checks.atomicMediaOk
          ? 'Plex metadata no longer matches the duplicate detected during scan'
          : 'Stacked media with multiple file parts cannot be safely deleted at media scope',
        detail: checks,
      })
    }

    let keeperMetadata: any
    try {
      const data = await plexJson<any>(
        `/library/metadata/${keeperRatingKey}`,
        { signal: leaseAbort.signal },
      )
      keeperMetadata = data.MediaContainer?.Metadata?.[0]
      if (!keeperMetadata) throw new Error('Keeper copy not found on Plex')
      if (keeperMetadata.guid !== body.expectedGuid) throw new Error('Keeper guid mismatch')
      const found = findMediaAndPart(
        keeperMetadata,
        keeperMediaId,
        body.keeperFilePath,
      )
      if (!found.media) throw new Error('Keeper media version not found on Plex')
      if (normalizeResolution(found.media.videoResolution) !== expectedResolution) {
        throw new Error('Keeper resolution does not match the duplicate group')
      }
      if (detectThreeD(found.part?.file) !== body.expectedIs3D) {
        throw new Error('Keeper edition does not match the duplicate group')
      }
    } catch (error) {
      audit({ ...base, action: 'delete_attempt', status: 'verify_failed',
        snapshot_json: safeJson({
          request: JSON.parse(requestSnapshot),
          targetMetadata,
          keeperMetadata: keeperMetadata || null,
        }),
        error_message: error instanceof Error ? error.message : String(error) })
      return res.status(409).json({ error: 'Could not verify keeper on Plex' })
    }

    try {
      const root = await plexJson<any>('/', { signal: leaseAbort.signal })
      if (!root.MediaContainer?.allowMediaDeletion) {
        audit({ ...base, action: 'delete_attempt', status: 'failed',
          snapshot_json: safeJson({ request: JSON.parse(requestSnapshot), targetMetadata, keeperMetadata }),
          error_message: 'Plex media deletion is disabled' })
        return res.status(412).json({
          error: 'Plex server has "Allow media deletion" disabled.',
        })
      }
    } catch (error) {
      audit({ ...base, action: 'delete_attempt', status: 'failed',
        snapshot_json: safeJson({ request: JSON.parse(requestSnapshot), targetMetadata, keeperMetadata }),
        error_message: `Could not check server-config: ${message(error)}` })
      return res.status(502).json({ error: 'Could not verify Plex server config' })
    }

    const snapshot = {
      ...base,
      library_id: targetMetadata.librarySectionID == null
        ? null : String(targetMetadata.librarySectionID),
      library_title: base.library_title || targetMetadata.librarySectionTitle || null,
      file_size: Number(targetPart?.size) || null,
      duration_ms: Number(targetMetadata.duration) || null,
      bitrate_kbps: Number(targetMedia?.bitrate) || null,
      resolution: targetMedia?.videoResolution || null,
      video_codec: targetMedia?.videoCodec || null,
      audio_codec: targetMedia?.audioCodec || null,
      audio_channels: Number(targetMedia?.audioChannels) || null,
      container: targetMedia?.container || null,
      snapshot_json: safeJson({
        request: JSON.parse(requestSnapshot),
        metadata: targetMetadata,
        keeperMetadata,
        deletedMediaId: expectedMediaId,
        deletedPartId: targetPart?.id || null,
      }),
    }
    try {
      audit({ ...snapshot, action: 'delete_attempt', status: 'success' })
    } catch (error) {
      console.error('Refusing Plex delete because pre-delete audit failed:', error)
      return res.status(503).json({ error: 'Delete audit could not be persisted' })
    }

    const deletePath = `/library/metadata/${deleteRatingKey}/media/${expectedMediaId}`
    try {
      leaseGuard.assert()
    } catch {
      leaseAbort.abort(new Error('Runtime SQLite instance lease was lost'))
      audit({
        ...snapshot,
        action: 'delete',
        status: 'verify_failed',
        error_message: 'Runtime SQLite instance lease was lost before Plex DELETE dispatch',
      })
      return res.status(503).json({
        error: 'Deletion fenced because this process lost the database instance lease',
        code: 'INSTANCE_LEASE_LOST',
        retry: false,
        correlationId,
      })
    }
    try {
      const response = await plexFetch(deletePath, {
        method: 'DELETE',
        signal: leaseAbort.signal,
      })
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '')
        audit({ ...snapshot, action: 'delete', status: 'failed',
          error_message: `Plex DELETE returned ${response.status}: ${responseBody.slice(0, 500)}` })
        return res.status(502).json({ error: `Plex rejected the delete (${response.status})` })
      }
    } catch (error) {
      audit({ ...snapshot, action: 'delete', status: 'unknown',
        error_message: `Plex DELETE transport outcome is unknown: ${message(error)}` })
      return res.status(409).json({
        error: 'Plex DELETE outcome is unknown; verify Plex state before retrying',
        correlationId,
      })
    }

    try {
      audit({ ...snapshot, action: 'delete', status: 'success' })
    } catch (error) {
      console.error('Plex delete committed but success audit could not be appended:', error)
      return res.status(202).json({
        success: true,
        committed: true,
        auditRecorded: false,
        retry: false,
        outcome: 'committed_audit_unrecorded',
        correlationId,
        deletedRatingKey: deleteRatingKey,
        deletedFilePath: body.expectedFilePath,
        deletedFileSize: snapshot.file_size,
        title: body.expectedTitle,
        year: body.expectedYear,
      })
    }
    return res.json({
      success: true,
      correlationId,
      deletedRatingKey: body.deleteRatingKey,
      deletedFilePath: body.expectedFilePath,
      deletedFileSize: snapshot.file_size,
      title: body.expectedTitle,
      year: body.expectedYear,
    })
    } finally {
      unsubscribeLeaseLoss()
      releaseDeleteLock(leaseAbort.signal.aborted)
    }
  })

  router.get('/api/plex/duplicates/savings', (_req, res) => {
    const totals = db.prepare(`
      SELECT COALESCE(SUM(file_size), 0) AS total_bytes, COUNT(*) AS delete_count,
             MIN(ts) AS first_delete_at, MAX(ts) AS last_delete_at
      FROM plex_action_log
      WHERE action = 'delete' AND status = 'success' AND file_size IS NOT NULL
    `).get() as any
    const byMonth = db.prepare(`
      SELECT strftime('%Y-%m', ts / 1000, 'unixepoch') AS month,
             SUM(file_size) AS bytes, COUNT(*) AS count
      FROM plex_action_log
      WHERE action = 'delete' AND status = 'success' AND file_size IS NOT NULL
      GROUP BY month ORDER BY month ASC
    `).all()
    res.json({
      totalBytesSaved: Number(totals.total_bytes) || 0,
      deleteCount: Number(totals.delete_count) || 0,
      firstDeleteAt: totals.first_delete_at ?? null,
      lastDeleteAt: totals.last_delete_at ?? null,
      byMonth,
    })
  })

  router.get('/api/plex/duplicates/audit', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const conditions: string[] = []
    const parameters: Record<string, unknown> = { limit, offset }
    if (req.query.action) {
      conditions.push('action = @action')
      parameters.action = String(req.query.action)
    }
    if (req.query.status) {
      conditions.push('status = @status')
      parameters.status = String(req.query.status)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM plex_action_log ${where}`)
      .get(parameters) as { count: number }).count
    const rows = db.prepare(`
      SELECT * FROM plex_action_log ${where} ORDER BY ts DESC LIMIT @limit OFFSET @offset
    `).all(parameters) as any[]
    res.json({
      total,
      limit,
      offset,
      entries: rows.map((row) => ({
        ...row,
        snapshot: row.snapshot_json ? parseJson(row.snapshot_json) : null,
      })),
    })
  })

  return router
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const parseJson = (value: string) => {
  try { return JSON.parse(value) } catch { return null }
}
