import express from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth/serviceTokens.js', () => ({
  requireWatchtower: () => (_req: any, _res: any, next: any) => next(),
  requireWorkload: () => (_req: any, _res: any, next: any) => next(),
}))
const mocks = vi.hoisted(() => ({
  plexJson: vi.fn(),
  plexFetch: vi.fn(),
}))
vi.mock('../../server/clients/plex.js', () => mocks)
const { plexJson, plexFetch } = mocks

import {
  createContractsV1Router,
} from '../../server/routes/contractsV1.js'
import {
  cancelResponseBody,
  readBoundedResponseBody,
} from '../../server/domain/media/boundedBody.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('Prism opaque artwork contract', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns no Plex path and resolves artwork through the workload route', async () => {
    plexJson
      .mockResolvedValueOnce({
        MediaContainer: { Directory: [{ key: '9', title: 'Movies', type: 'movie' }] },
      })
      .mockResolvedValueOnce({
        MediaContainer: {
          Metadata: [{
            ratingKey: '1',
            type: 'movie',
            title: 'Movie',
            year: 2020,
            thumb: '/library/metadata/1/thumb/123',
            Media: [{ Part: [{ file: 'P:\\secret\\movie.mkv' }] }],
          }],
        },
      })
    plexFetch.mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '3' },
    }))
    const handle = temporaryDatabase()
    const router = createContractsV1Router(handle.db)
    const initialRouteCount = (router as any).stack.length
    const app = express().use(express.json()).use(router)
    try {
      await withServer(app, async (url) => {
        const search = await fetch(`${url}/api/contracts/v1/media/search?q=Movie`)
        expect(search.status).toBe(200)
        const payload = await search.json() as any
        expect(Object.keys(payload).sort()).toEqual(['count', 'items', 'query', 'schema'])
        expect(Object.keys(payload.items[0]).sort()).toEqual([
          'artwork', 'durationMs', 'id', 'library', 'summary', 'title', 'type', 'year',
        ])
        const serialized = JSON.stringify(payload)
        expect(serialized).not.toContain('/library/metadata')
        expect(serialized).not.toContain('secret')
        expect(payload.items[0].artwork.href)
          .toMatch(/^\/api\/contracts\/v1\/media\/artwork\/[0-9a-f-]{36}$/)
        expect((router as any).stack.length).toBe(initialRouteCount)

        const artwork = await fetch(`${url}${payload.items[0].artwork.href}`)
        expect(artwork.status).toBe(200)
        expect(artwork.headers.get('content-type')).toContain('image/jpeg')
        expect(Buffer.from(await artwork.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
      })
    } finally {
      handle.cleanup()
    }
  })

  it('cancels a chunked artwork body as soon as the cumulative bound is crossed', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    })
    await expect(readBoundedResponseBody(new Response(body), 3))
      .rejects.toThrow('RESPONSE_BODY_TOO_LARGE')
  })

  it('cancels an unread upstream body on early rejection', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({
      cancel() { cancelled = true },
    }))
    await cancelResponseBody(response)
    expect(cancelled).toBe(true)
  })
})
