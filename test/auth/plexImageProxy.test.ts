import { describe, expect, it } from 'vitest'
import { isAllowedPlexArtworkUrl } from '../../server/routes/plex.js'

describe('Plex image proxy allow-list', () => {
  const origin = 'https://plex.enzolopez.net'

  it('accepts only known artwork and transcode endpoints', () => {
    expect(isAllowedPlexArtworkUrl(
      new URL('https://plex.enzolopez.net/library/metadata/12/thumb/123'),
      origin,
    )).toBe(true)
    expect(isAllowedPlexArtworkUrl(
      new URL('https://plex.enzolopez.net/photo/:/transcode?url=%2Flibrary%2Fmetadata%2F12%2Fthumb%2F123'),
      origin,
    )).toBe(true)
    expect(isAllowedPlexArtworkUrl(
      new URL('https://plex.enzolopez.net/photo/:/transcode?url=http%3A%2F%2F127.0.0.1%3A8080%2Fadmin'),
      origin,
    )).toBe(false)
    expect(isAllowedPlexArtworkUrl(
      new URL('https://plex.enzolopez.net/library/sections/9/all'),
      origin,
    )).toBe(false)
    expect(isAllowedPlexArtworkUrl(
      new URL('https://attacker.example/library/metadata/12/thumb/123'),
      origin,
    )).toBe(false)
    expect(isAllowedPlexArtworkUrl(
      new URL('https://unrelated.enzolopez.net/library/metadata/12/thumb/123'),
      origin,
    )).toBe(false)
  })
})
