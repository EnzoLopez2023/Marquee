import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'

import {
  collectFast,
  collectFull,
  collectSnapshot,
  createCollectionState,
  drainOnly,
  loadConfig,
  sanitizeAgentLogMessage,
  pushSnapshot,
} from '../../scripts/sonarr-agent/sonarr-agent.mjs'

const config = {
  marqueeUrl: 'https://marquee.test',
  ingestToken: 'test-token',
  sonarrUrl: 'http://sonarr.test',
  sonarrApiKey: 'test-key',
  requestTimeoutSeconds: 5,
  fullPollMinutes: 0,
  pollMinutes: 2,
}

const success = (key: string, value: unknown, at = 10) => ({
  key,
  path: `/api/${key}`,
  ok: true,
  stale: false,
  count: Array.isArray(value) ? value.length : 1,
  collected_at: at,
  last_success_at: at,
  duration_ms: 0,
})

const failure = (key: string, previousValue: unknown, lastSuccessAt: number) => ({
  key,
  path: `/api/${key}`,
  ok: false,
  stale: true,
  count: Array.isArray(previousValue) ? previousValue.length : 1,
  collected_at: lastSuccessAt + 1,
  last_success_at: lastSuccessAt,
  duration_ms: 0,
  error: 'endpoint unavailable',
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SHIP_LOGS
})

describe('Sonarr collection hardening', () => {
  it('redacts absolute filesystem paths before agent log shipment', () => {
    expect(sanitizeAgentLogMessage(
      'Sonarr returned 500 for C:\\ProgramData\\Sonarr\\config.xml',
    )).toBe('[redacted filesystem path]')
    expect(sanitizeAgentLogMessage(
      'error:/var/lib/sonarr/config.xml',
    )).toBe('[redacted filesystem path]')
    expect(sanitizeAgentLogMessage('Sonarr endpoint /api/v3/series failed'))
      .toBe('Sonarr endpoint /api/v3/series failed')
  })

  it('retains a failed fast endpoint value and reports its stale failure diagnostic', async () => {
    process.env.SHIP_LOGS = 'false'
    loadConfig()
    let failQueue = false
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: URL | string) => {
      const path = new URL(String(rawUrl)).pathname
      if (path === '/api/v3/queue' && failQueue) return new Response('unavailable', { status: 503 })
      if (path === '/api/v3/queue') {
        return Response.json({ records: [{ id: 7 }], totalRecords: 1, pageSize: 1000 })
      }
      if (path === '/api/v3/history' || path === '/api/v3/log') {
        return Response.json({ records: [], totalRecords: 0, pageSize: 1000 })
      }
      if (path === '/api/v3/system/status') return Response.json({ instanceName: 'Sonarr' })
      return Response.json([])
    }))

    const initial = await collectFast(config)
    failQueue = true
    const retry = await collectFast(config, initial.data, initial.diagnostics)
    const queueDiagnostic = retry.diagnostics.find((item) => item.key === 'queue')

    expect(retry.data.queue).toMatchObject({ records: [{ id: 7 }], totalRecords: 1 })
    expect(queueDiagnostic).toMatchObject({
      ok: false,
      stale: true,
      count: 1,
      last_success_at: initial.diagnostics.find((item) => item.key === 'queue')?.last_success_at,
    })
  })

  it('retains partial full data and advances full completion only after every endpoint succeeds', async () => {
    const state = createCollectionState()
    let clock = 100
    const now = () => clock
    const fullSuccess = async () => ({
      data: { series: [{ id: 1, title: 'Retained show' }] },
      diagnostics: [success('series', [{ id: 1 }], 100)],
    })
    const fastSuccess = async () => ({
      data: { queue: [{ id: 2 }] },
      diagnostics: [success('queue', [{ id: 2 }], 100)],
    })

    await collectSnapshot(config, state, {
      now,
      fullCollector: fullSuccess,
      fastCollector: fastSuccess,
    })
    expect(state.lastFullAt).toBe(100)

    clock = 200
    const partial = await collectSnapshot(config, state, {
      now,
      fullCollector: async (_config, previousData, previousDiagnostics) => ({
        data: { ...previousData },
        diagnostics: [failure(
          'series',
          previousData.series,
          previousDiagnostics[0]?.last_success_at ?? 0,
        )],
      }),
      fastCollector: async (_config, previousData, previousDiagnostics) => ({
        data: { ...previousData },
        diagnostics: [failure(
          'queue',
          previousData.queue,
          previousDiagnostics[0]?.last_success_at ?? 0,
        )],
      }),
    })

    expect(state.lastFullAt).toBe(100)
    expect(partial.snapshot.agent.full_collected_at).toBe(100)
    expect(partial.snapshot.data).toMatchObject({
      series: [{ id: 1, title: 'Retained show' }],
      queue: [{ id: 2 }],
    })
    expect(partial.snapshot.collection).toMatchObject({
      mode: 'full',
      failed_endpoint_count: 2,
      stale_endpoint_count: 2,
      full_poll: { due: true, complete: false, last_completed_at: 100 },
    })
    expect(partial.snapshot.collection.unavailable).toEqual([
      expect.objectContaining({ key: 'series', stale: true, last_success_at: 100 }),
      expect.objectContaining({ key: 'queue', stale: true, last_success_at: 100 }),
    ])
  })

  it('does not retry a failed full collection until the configured full cadence', async () => {
    const state = createCollectionState()
    const cadenceConfig = { ...config, fullPollMinutes: 10 }
    let clock = 1_000
    let fullCalls = 0
    const fastCollector = async () => ({
      data: { queue: [] },
      diagnostics: [success('queue', [], clock)],
    })
    const fullCollector = async () => {
      fullCalls += 1
      return {
        data: { series: [{ id: 1 }] },
        diagnostics: [failure('series', [{ id: 1 }], 500)],
      }
    }

    const first = await collectSnapshot(cadenceConfig, state, {
      now: () => clock,
      fastCollector,
      fullCollector,
    })
    expect(first.fullDue).toBe(true)
    expect(state.lastFullAttemptAt).toBe(1_000)
    expect(state.lastFullAt).toBe(0)

    clock += 2 * 60_000
    const fastOnly = await collectSnapshot(cadenceConfig, state, {
      now: () => clock,
      fastCollector,
      fullCollector,
    })
    expect(fullCalls).toBe(1)
    expect(fastOnly.fullDue).toBe(false)
    expect(fastOnly.snapshot.collection.full_poll).toMatchObject({
      due: false,
      complete: false,
      last_completed_at: null,
      last_attempted_at: 1_000,
    })
    expect(fastOnly.snapshot.collection.unavailable).toEqual([
      expect.objectContaining({ key: 'series', stale: true, last_success_at: 500 }),
    ])

    clock = 1_000 + 10 * 60_000
    const retry = await collectSnapshot(cadenceConfig, state, {
      now: () => clock,
      fastCollector,
      fullCollector,
    })
    expect(fullCalls).toBe(2)
    expect(retry.fullDue).toBe(true)
    expect(state.lastFullAttemptAt).toBe(clock)
    expect(state.lastFullAt).toBe(0)
  })

  it('removes filesystem paths from the exact gzip payload queued for delivery', async () => {
    let queuedBody = ''
    const queue = {
      enqueue: vi.fn(({ body }) => {
        queuedBody = body
        return 'queued-snapshot'
      }),
      flush: vi.fn(async () => ({
        acceptedIds: [],
        deadLetteredIds: [],
        pending: 1,
      })),
    }

    await pushSnapshot(config, {
      source: {
        startupPath: 'C:\\ProgramData\\Sonarr\\bin',
        appData: '/var/lib/sonarr',
      },
      collection: {
        endpoints: [{ path: '/api/v3/series', message: 'Read \\\\server\\share\\show.mkv' }],
      },
      data: {
        rootFolders: [{ path: 'P:\\TV', nested: { directory: '/mnt/tv' } }],
        series: [{ title: 'Safe Show', rootFolderPath: 'P:\\TV\\Safe Show' }],
        history: [{ message: 'Imported /mnt/tv/Safe Show/episode.mkv' }],
        pathIndexed: { '/mnt/tv/Safe Show/episode.mkv': 'indexed' },
      },
      insights: { upcoming: [{ episodeFile: { relativePath: '/mnt/tv/episode.mkv' } }] },
    }, { queue })

    const envelope = JSON.parse(queuedBody)
    const delivered = JSON.parse(gunzipSync(Buffer.from(envelope.payload, 'base64')).toString('utf8'))
    const assertNoPathFields = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(assertNoPathFields)
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        expect(key).not.toMatch(/^(?:appdata|.*(?:paths?|folders?|directory|directories))$/i)
        assertNoPathFields(nested)
      }
    }

    expect(envelope.encoding).toBe('gzip-base64')
    assertNoPathFields(delivered)
    expect(delivered.collection.endpoints[0]).toEqual({
      message: '[redacted filesystem path]',
    })
    expect(delivered.data.history[0].message).toBe('[redacted filesystem path]')
    expect(JSON.stringify(delivered)).not.toContain('P:\\TV')
    expect(JSON.stringify(delivered)).not.toContain('/mnt/tv')
    expect(JSON.stringify(delivered)).not.toContain('\\\\server\\share')
  })

  it('clears series detail maps after a successful empty series response but retains them on failure', async () => {
    process.env.SHIP_LOGS = 'false'
    loadConfig()
    const previous = {
      series: [{ id: 1, title: 'Old series' }],
      episodesBySeries: { '1': [{ id: 10 }] },
      episodeFilesBySeries: { '1': [{ id: 100 }] },
    }
    let seriesFails = false
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: URL | string) => {
      if (new URL(String(rawUrl)).pathname === '/api/v3/series' && seriesFails) {
        return new Response('unavailable', { status: 503 })
      }
      return Response.json([])
    }))

    const empty = await collectFull(config, previous)
    expect(empty.data.series).toEqual([])
    expect(empty.data.episodesBySeries).toEqual({})
    expect(empty.data.episodeFilesBySeries).toEqual({})

    seriesFails = true
    const failed = await collectFull(config, previous)
    expect(failed.data.episodesBySeries).toEqual(previous.episodesBySeries)
    expect(failed.data.episodeFilesBySeries).toEqual(previous.episodeFilesBySeries)
    expect(failed.diagnostics.find((item) => item.key === 'series')).toMatchObject({ ok: false, stale: true })
  })

  it('drain-only flushes without invoking Sonarr collectors or adding queue entries', async () => {
    let pending = 1
    const enqueue = vi.fn(() => { throw new Error('drain-only must not enqueue') })
    const queue = {
      status: vi.fn(() => ({ pending })),
      flush: vi.fn(async () => {
        pending = 0
        return { accepted: 1, deadLettered: 0, pending }
      }),
      enqueue,
    }
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)

    await drainOnly({ marqueeUrl: 'https://marquee.test', ingestToken: 'token' }, { queue })

    expect(queue.flush).toHaveBeenCalledWith({
      baseUrl: 'https://marquee.test',
      token: 'token',
      maxRequests: 50,
    })
    expect(fetchStub).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
