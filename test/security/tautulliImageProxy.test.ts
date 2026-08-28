import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TAUTULLI_API_KEY = 'test-tautulli-key'
})

import tautulliRouter, {
  boundedImageDimension,
  isAllowedTautulliImagePath,
} from '../../server/routes/tautulli.js'
import { withServer } from '../helpers.js'

const nativeFetch = globalThis.fetch.bind(globalThis)
const proxyFetch = (upstream: (url: string) => Promise<Response>) => (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = String(input)
  return url.startsWith('http://127.0.0.1:')
    ? nativeFetch(input, init)
    : upstream(url)
}

describe('Tautulli image proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows only relative Plex artwork paths and bounded dimensions', () => {
    expect(isAllowedTautulliImagePath('/library/metadata/12/thumb/123')).toBe(true)
    expect(isAllowedTautulliImagePath('/playlists/4/composite')).toBe(true)
    for (const hostile of [
      'http://127.0.0.1/admin',
      'https://example.com/image.jpg',
      '//127.0.0.1/admin',
      '/../admin',
      '/library/metadata/12/../sections',
      '/library\\metadata\\12\\thumb',
      '/library/metadata/12/thumb?url=http://127.0.0.1',
      '/library/metadata/12/thumb#fragment',
      '/library/sections/9/all',
    ]) expect(isAllowedTautulliImagePath(hostile), hostile).toBe(false)
    expect(boundedImageDimension('1', 150)).toBe(1)
    expect(boundedImageDimension('2000', 150)).toBe(2000)
    expect(boundedImageDimension('2001', 150)).toBeNull()
    expect(boundedImageDimension('-1', 150)).toBeNull()
  })

  it('rejects SSRF and invalid dimensions before an upstream request', async () => {
    const upstream = vi.fn(async (_url: string) => new Response())
    vi.stubGlobal('fetch', proxyFetch(upstream))
    const app = express().use(tautulliRouter)
    await withServer(app, async (url) => {
      const hostile = await fetch(
        `${url}/api/tautulli/image?img=${encodeURIComponent('http://127.0.0.1/admin')}`,
      )
      const dimensions = await fetch(
        `${url}/api/tautulli/image?img=${encodeURIComponent('/library/metadata/12/thumb/123')}&width=999999`,
      )
      expect(hostile.status).toBe(400)
      expect(dimensions.status).toBe(400)
      expect(upstream).not.toHaveBeenCalled()
    })
  })

  it('cancels non-image and declared-oversize upstream responses', async () => {
    let nonImageCancelled = false
    let oversizeCancelled = false
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({
        cancel() { nonImageCancelled = true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        cancel() { oversizeCancelled = true },
      }), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(11 * 1024 * 1024) },
      }))
    vi.stubGlobal('fetch', proxyFetch(upstream))
    const app = express().use(tautulliRouter)
    await withServer(app, async (url) => {
      const endpoint = `${url}/api/tautulli/image?img=${encodeURIComponent('/library/metadata/12/thumb/123')}`
      expect((await fetch(endpoint)).status).toBe(502)
      expect((await fetch(endpoint)).status).toBe(413)
      expect(nonImageCancelled).toBe(true)
      expect(oversizeCancelled).toBe(true)
    })
  })

  it('cancels a chunked image as soon as the cumulative cap is exceeded', async () => {
    let cancelled = false
    vi.stubGlobal('fetch', proxyFetch(vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024))
        controller.enqueue(new Uint8Array(5 * 1024 * 1024))
      },
      cancel() { cancelled = true },
    }), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))))
    const app = express().use(tautulliRouter)
    await withServer(app, async (url) => {
      const endpoint = `${url}/api/tautulli/image?img=${encodeURIComponent('/library/metadata/12/thumb/123')}`
      expect((await fetch(endpoint)).status).toBe(413)
      expect(cancelled).toBe(true)
    })
  })
})
