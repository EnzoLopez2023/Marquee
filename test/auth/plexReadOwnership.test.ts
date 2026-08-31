import { describe, expect, it } from 'vitest'
import {
  duplicateResponseContainsPaths,
  plexRouteOwnership,
} from '../../server/app.js'
import { sanitizeMediaPaths } from '../../server/domain/media/sanitize.js'

describe('Plex read ownership and path minimization', () => {
  it('maps every Plex read family to its owning feature', () => {
    expect(plexRouteOwnership('/sections', 'GET')).toBe('plex-library')
    expect(plexRouteOwnership('/sections/9/all', 'GET')).toBe('plex-library')
    expect(plexRouteOwnership('/search', 'GET')).toBe('plex-library')
    expect(plexRouteOwnership('/library/9/playlists', 'GET')).toBe('plex-command-center')
    expect(plexRouteOwnership('/playlists', 'GET')).toBe('plex-command-center')
    expect(plexRouteOwnership('/playlists/1/items', 'GET')).toBe('plex-command-center')
    expect(plexRouteOwnership('/PLAYLISTS/1/ITEMS/', 'get')).toBe('plex-command-center')
    expect(plexRouteOwnership('/Library/9/Playlists///', 'GET')).toBe('plex-command-center')
    expect(plexRouteOwnership('/image', 'GET')).toBe('shared')
  })

  it('marks scan and audit responses as destructive path-bearing data', () => {
    expect(duplicateResponseContainsPaths('/scan')).toBe(true)
    expect(duplicateResponseContainsPaths('/AUDIT/')).toBe(true)
    expect(duplicateResponseContainsPaths('/savings')).toBe(false)
    expect(duplicateResponseContainsPaths('/server-config')).toBe(false)
  })

  it('recursively removes filesystem paths from general media responses', () => {
    const sanitized = sanitizeMediaPaths({
      title: 'Movie',
      Media: [{ Part: [{ file: 'P:\\secret\\movie.mkv', size: 10 }] }],
      nested: { file_path: '/secret/movie.mkv', safe: true },
      Directory: [{
        key: '9',
        title: 'Movies',
        type: 'movie',
        Location: [{ path: 'P:\\Movies' }],
      }],
      directory: '/secret/library',
      message: 'Found /private/media/movie.mkv',
      ordinary: 'GET /api/v3/series succeeded',
    })
    expect(sanitized).toEqual({
      title: 'Movie',
      Media: [{ Part: [{ size: 10 }] }],
      nested: { safe: true },
      Directory: [{
        key: '9',
        title: 'Movies',
        type: 'movie',
        Location: [{}],
      }],
      message: '[redacted filesystem path]',
      ordinary: 'GET /api/v3/series succeeded',
    })
  })

  it('preserves canonical Plex artwork routes without exposing arbitrary paths', () => {
    expect(sanitizeMediaPaths({
      thumb: '/library/metadata/12/thumb/123',
      art: '/library/metadata/12/art',
      collectionThumb: '/library/collections/8/thumb/456',
      playlistComposite: '/playlists/4/composite/789',
      invalidArtwork: '/library/metadata/not-an-id/thumb/private',
      filesystemPath: '/private/media/poster.jpg',
    })).toEqual({
      thumb: '/library/metadata/12/thumb/123',
      art: '/library/metadata/12/art',
      collectionThumb: '/library/collections/8/thumb/456',
      playlistComposite: '/playlists/4/composite/789',
      invalidArtwork: '[redacted filesystem path]',
    })
  })
})
