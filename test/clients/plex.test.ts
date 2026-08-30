import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/config.js', () => ({
  config: {
    plex: {
      baseUrl: 'https://plex.example:32400',
      token: 'test-token',
      tls: {
        insecure: false,
        caFile: '',
        certificateSha256: '',
      },
    },
  },
}))

import { plexFetch } from '../../server/clients/plex.js'

describe('Plex client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests JSON responses with the Accept header Plex honors', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)

    await plexFetch('/library/sections')

    const [url, init] = fetchStub.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('X-Plex-Container-Format')).toBe('json')
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
  })

  it('does not override XML and image response negotiation', async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('<MediaContainer/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)

    await plexFetch('/library/sections', { accept: 'xml' })
    await plexFetch('/library/metadata/1/thumb/2', { accept: 'image' })

    for (const [url, init] of fetchStub.mock.calls) {
      expect(new URL(String(url)).searchParams.has('X-Plex-Container-Format')).toBe(false)
      expect(new Headers(init?.headers).has('Accept')).toBe(false)
    }
  })
})
