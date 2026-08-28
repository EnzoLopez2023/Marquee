import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireAuthenticatedImage,
  releaseAuthenticatedImage,
} from '../../src/services/authenticatedImage.js'
import { setAccessTokenProvider } from '../../src/services/apiClient.js'

describe('authenticated image object URL cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setAccessTokenProvider()
  })

  it('deduplicates bearer fetches and revokes on last release', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['image']), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    const createObjectURL = vi.fn().mockReturnValue('blob:marquee-image')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })
    setAccessTokenProvider(async () => 'access-token')
    const first = acquireAuthenticatedImage('/api/plex/image?path=thumb')
    const second = acquireAuthenticatedImage('/api/plex/image?path=thumb')
    expect(await first).toBe('blob:marquee-image')
    expect(await second).toBe('blob:marquee-image')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect(new Headers(init?.headers).get('Authorization'))
      .toBe('Bearer access-token')
    releaseAuthenticatedImage('/api/plex/image?path=thumb')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    releaseAuthenticatedImage('/api/plex/image?path=thumb')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:marquee-image')
  })

  it('revokes an object URL when the last consumer leaves before fetch completes', async () => {
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })))
    const createObjectURL = vi.fn().mockReturnValue('blob:late-image')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const promise = acquireAuthenticatedImage('/api/tautulli/image?img=late')
    await Promise.resolve()
    await Promise.resolve()
    releaseAuthenticatedImage('/api/tautulli/image?img=late')
    resolveResponse(new Response(new Blob(['image'])))
    await promise
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-image')
  })

  it('cannot let a stale fetch overwrite or leak a replacement cache entry', async () => {
    const resolvers: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve)
    })))
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:replacement')
      .mockReturnValueOnce('blob:stale')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const stale = acquireAuthenticatedImage('/api/plex/image?path=race')
    await Promise.resolve()
    await Promise.resolve()
    releaseAuthenticatedImage('/api/plex/image?path=race')
    const replacement = acquireAuthenticatedImage('/api/plex/image?path=race')
    await Promise.resolve()
    await Promise.resolve()

    resolvers[1]!(new Response(new Blob(['replacement'])))
    expect(await replacement).toBe('blob:replacement')
    resolvers[0]!(new Response(new Blob(['stale'])))
    expect(await stale).toBe('blob:stale')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale')

    releaseAuthenticatedImage('/api/plex/image?path=race')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:replacement')
  })
})
