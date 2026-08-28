import express from 'express'
import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { temporaryDatabase, withServer } from '../helpers.js'

const mocks = vi.hoisted(() => ({
  plexJson: vi.fn(),
  plexFetch: vi.fn(),
}))
vi.mock('../../server/clients/plex.js', () => mocks)
const { plexJson, plexFetch } = mocks

const body = {
  deleteRatingKey: '1',
  expectedGuid: 'imdb://tt1',
  expectedTitle: 'Movie',
  expectedYear: 2020,
  expectedFilePath: '/delete.mkv',
  expectedMediaId: '10',
  expectedLibraryTitles: ['Movies'],
  expectedRatingKeys: ['1'],
  keeperRatingKey: '2',
  keeperMediaId: '20',
  keeperFilePath: '/keep.mkv',
  expectedResolution: '1080',
  expectedIs3D: false,
  confirmToken: 'DELETE',
}
const metadata = (ratingKey: string, mediaId: string, file: string) => ({
  ratingKey,
  guid: 'imdb://tt1',
  title: 'Movie',
  year: 2020,
  duration: 7_200_000,
  librarySectionID: '1',
  librarySectionTitle: 'Movies',
  Media: [{ id: mediaId, bitrate: 5_000, videoResolution: '1080', Part: [{ id: mediaId, file, size: 100 }] }],
})

describe('six duplicate deletion guards', () => {
  beforeEach(() => vi.resetAllMocks())

  async function request(
    payload: any,
    setup?: (db: Database.Database) => void,
    leaseGuard?: { assert(): void; onLost(listener: () => void): () => void },
  ) {
    const handle = temporaryDatabase()
    setup?.(handle.db)
    const { createPlexDuplicatesRouter } = await import('../../server/routes/plexDuplicates.js')
    const app = express().use(express.json()).use(
      createPlexDuplicatesRouter(handle.db, leaseGuard),
    )
    try {
      return await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/plex/duplicates/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return {
          status: response.status,
          data: await response.json(),
          audits: handle.db.prepare('SELECT action, status, snapshot_json FROM plex_action_log ORDER BY id').all() as any[],
        }
      })
    } finally {
      handle.cleanup()
    }
  }

  it('guard 1 cancels an invalid confirmation before Plex calls', async () => {
    const result = await request({ ...body, confirmToken: 'delete' })
    expect(result.status).toBe(400)
    expect(result.audits[0].status).toBe('cancelled')
    expect(plexJson).not.toHaveBeenCalled()
  })

  it('guard 2 rejects missing required identity', async () => {
    const result = await request({ ...body, expectedGuid: '' })
    expect(result.status).toBe(400)
    expect(result.audits[0].status).toBe('verify_failed')
  })

  it('guard 2 rejects a missing media id instead of falling back to metadata deletion', async () => {
    const result = await request({ ...body, expectedMediaId: null })
    expect(result.status).toBe(400)
    expect(result.audits[0].status).toBe('verify_failed')
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('guard 2 rejects hostile rating/media identifiers before Plex calls', async () => {
    const result = await request({
      ...body,
      deleteRatingKey: '1/../2?X-Plex-Token=stolen',
      expectedMediaId: '10\\11',
    })
    expect(result.status).toBe(400)
    expect(result.audits[0].status).toBe('verify_failed')
    expect(plexJson).not.toHaveBeenCalled()
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('guard 3 rejects a target mismatch', async () => {
    plexJson.mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/changed.mkv')] } })
    const result = await request(body)
    expect(result.status).toBe(409)
    expect(result.audits[0].status).toBe('verify_failed')
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('guard 3 rejects a stacked Media because Plex deletes at media scope', async () => {
    const stacked = metadata('1', '10', '/delete.mkv')
    stacked.Media[0]!.Part.push({ id: '11', file: '/cd2.mkv', size: 100 })
    plexJson.mockResolvedValueOnce({ MediaContainer: { Metadata: [stacked] } })
    const result = await request(body)
    expect(result.status).toBe(409)
    expect(result.data.error).toContain('Stacked media')
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('guard 4 rejects a missing keeper', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: {} })
    const result = await request(body)
    expect(result.status).toBe(409)
    expect(result.audits[0].status).toBe('verify_failed')
  })

  it('guard 4 rejects a keeper that is physically equivalent to the target', async () => {
    const result = await request({
      ...body,
      keeperRatingKey: body.deleteRatingKey,
      keeperMediaId: body.expectedMediaId,
      keeperFilePath: body.expectedFilePath,
    })
    expect(result.status).toBe(409)
    expect(result.audits[0].status).toBe('verify_failed')
    expect(plexJson).not.toHaveBeenCalled()
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('guard 5 rejects disabled server deletion', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('2', '20', '/keep.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { allowMediaDeletion: false } })
    const result = await request(body)
    expect(result.status).toBe(412)
    expect(result.audits[0].status).toBe('failed')
  })

  it('guard 6 snapshots before deleting only the selected media', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('2', '20', '/keep.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { allowMediaDeletion: true } })
    plexFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const result = await request(body)
    expect(result.status).toBe(200)
    expect(plexFetch).toHaveBeenCalledWith(
      '/library/metadata/1/media/10',
      expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }),
    )
    expect(result.audits.map((row) => row.status)).toEqual(['success', 'success'])
    expect(JSON.parse(result.audits[0].snapshot_json).metadata.Media[0].id).toBe('10')
  })

  it('records a thrown Plex delete transport outcome as unknown', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('2', '20', '/keep.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { allowMediaDeletion: true } })
    plexFetch.mockRejectedValueOnce(new Error('socket closed'))
    const result = await request(body)
    expect(result.status).toBe(409)
    expect(result.audits.map((row) => row.status)).toEqual(['success', 'unknown'])
  })

  it('returns a nonretryable committed result when final success audit fails', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('2', '20', '/keep.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { allowMediaDeletion: true } })
    plexFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const result = await request(body, (db) => db.exec(`
      CREATE TRIGGER fail_final_delete_audit
      BEFORE INSERT ON plex_action_log
      WHEN NEW.action = 'delete' AND NEW.status = 'success'
      BEGIN
        SELECT RAISE(ABORT, 'simulated final audit failure');
      END;
    `))
    expect(result.status).toBe(202)
    expect(result.data).toMatchObject({
      committed: true,
      auditRecorded: false,
      retry: false,
      outcome: 'committed_audit_unrecorded',
    })
    expect(result.data.correlationId).toBeTruthy()
    expect(result.audits).toHaveLength(1)
    expect(result.audits[0]).toMatchObject({ action: 'delete_attempt', status: 'success' })
    expect(plexFetch).toHaveBeenCalledTimes(1)
  })

  it('allows at most one simultaneous inverse delete and preserves its keeper', async () => {
    const handle = temporaryDatabase()
    const { createPlexDuplicatesRouter } = await import('../../server/routes/plexDuplicates.js')
    const app = express().use(express.json()).use(createPlexDuplicatesRouter(handle.db))
    const alive = new Set(['1', '2'])
    let signalDeleteStarted!: () => void
    let releaseDelete!: () => void
    const deleteStarted = new Promise<void>((resolve) => { signalDeleteStarted = resolve })
    const deleteMayFinish = new Promise<void>((resolve) => { releaseDelete = resolve })
    plexJson.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { allowMediaDeletion: true } }
      const ratingKey = path.match(/^\/library\/metadata\/(\d+)$/)?.[1]
      if (!ratingKey || !alive.has(ratingKey)) return { MediaContainer: {} }
      const mediaId = ratingKey === '1' ? '10' : '20'
      const file = ratingKey === '1' ? '/delete.mkv' : '/keep.mkv'
      return { MediaContainer: { Metadata: [metadata(ratingKey, mediaId, file)] } }
    })
    plexFetch.mockImplementation(async (path: string) => {
      signalDeleteStarted()
      await deleteMayFinish
      const ratingKey = path.match(/^\/library\/metadata\/(\d+)\/media\/\d+$/)?.[1]
      if (ratingKey) alive.delete(ratingKey)
      return new Response(null, { status: 200 })
    })
    const inverse = {
      ...body,
      deleteRatingKey: '2',
      expectedFilePath: '/keep.mkv',
      expectedMediaId: '20',
      keeperRatingKey: '1',
      keeperMediaId: '10',
      keeperFilePath: '/delete.mkv',
    }
    const post = (url: string, payload: unknown) => fetch(
      `${url}/api/plex/duplicates/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    try {
      await withServer(app, async (url) => {
        const first = post(url, body)
        await deleteStarted
        const second = await post(url, inverse)
        expect(second.status).toBe(409)
        expect(await second.json()).toMatchObject({
          code: 'DUPLICATE_GROUP_BUSY',
          retry: false,
        })
        releaseDelete()
        expect((await first).status).toBe(200)
      })
      expect(plexFetch).toHaveBeenCalledTimes(1)
      expect(alive).toEqual(new Set(['2']))
    } finally {
      handle.cleanup()
    }
  })

  it('honors a nonexpired SQLite group lock from another process', async () => {
    const result = await request(body, (db) => {
      const now = Date.now()
      db.prepare(`
        INSERT INTO plex_delete_locks(lock_key, owner_id, acquired_at, expires_at)
        VALUES ('imdb://tt1|1080|2d', 'other-process', ?, ?)
      `).run(now, now + 60_000)
    })
    expect(result.status).toBe(409)
    expect(result.data.code).toBe('DUPLICATE_GROUP_BUSY')
    expect(plexJson).not.toHaveBeenCalled()
    expect(plexFetch).not.toHaveBeenCalled()
  })

  it('rechecks the instance lease immediately before Plex DELETE dispatch', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('1', '10', '/delete.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [metadata('2', '20', '/keep.mkv')] } })
      .mockResolvedValueOnce({ MediaContainer: { allowMediaDeletion: true } })
    let assertions = 0
    const result = await request(body, undefined, {
      assert() {
        assertions += 1
        if (assertions === 2) throw new Error('lease lost')
      },
      onLost() { return () => {} },
    })
    expect(result.status).toBe(503)
    expect(result.data).toMatchObject({
      code: 'INSTANCE_LEASE_LOST',
      retry: false,
    })
    expect(plexFetch).not.toHaveBeenCalled()
    expect(result.audits.map((row) => row.status)).toEqual(['success', 'verify_failed'])
  })
})
