import { Router } from 'express'
import { config } from '../config.js'
import { movieDetails } from '../clients/omdb.js'
import { plexDispatcher, plexJson } from '../clients/plex.js'
import { sanitizeMediaPaths } from '../domain/media/sanitize.js'
import {
  cancelResponseBody,
  readBoundedResponseBody,
} from '../domain/media/boundedBody.js'
import {
  canonicalPlexId,
  requireCanonicalPlexId,
} from '../domain/media/plexId.js'

const router = Router()
const fail = (res: any, message: string, error: unknown) => {
  console.error(message, error)
  return res.status(502).json({ error: message })
}
const requestId = (value: unknown, label: string, res: any) => {
  const id = canonicalPlexId(value)
  if (!id) res.status(400).json({ error: `Invalid ${label}` })
  return id
}
const ARTWORK_PATHS = [
  /^\/library\/metadata\/\d+\/(?:thumb|art)\/\d+$/,
  /^\/library\/collections\/\d+\/(?:thumb|art)\/\d+$/,
  /^\/playlists\/\d+\/composite\/\d+$/,
]

export function isAllowedPlexArtworkUrl(url: URL, plexOrigin: string) {
  if (url.origin !== plexOrigin) return false
  if (ARTWORK_PATHS.some((pattern) => pattern.test(url.pathname))) return true
  if (url.pathname !== '/photo/:/transcode') return false
  const source = url.searchParams.get('url')
  if (!source || !source.startsWith('/')) return false
  const sourceUrl = new URL(source, plexOrigin)
  return sourceUrl.origin === plexOrigin
    && ARTWORK_PATHS.some((pattern) => pattern.test(sourceUrl.pathname))
}
router.get('/api/plex/library', async (_req, res) => {
  try {
    const sectionId = requireCanonicalPlexId(
      config.plex.librarySection,
      'configured library section',
    )
    res.json(sanitizeMediaPaths(await plexJson(`/library/sections/${sectionId}/all`)))
  } catch (error) {
    fail(res, 'Failed to fetch Plex library', error)
  }
})

router.get('/api/plex/image', async (req, res) => {
  try {
    const value = typeof req.query.path === 'string' ? decodeURIComponent(req.query.path) : ''
    if (!value) return res.status(400).json({ error: 'Image path is required' })
    const plexOrigin = new URL(config.plex.baseUrl).origin
    const url = new URL(value, `${config.plex.baseUrl}/`)
    if (!isAllowedPlexArtworkUrl(url, plexOrigin)) {
      return res.status(400).json({ error: 'Invalid Plex artwork path' })
    }
    url.searchParams.delete('X-Plex-Token')
    if (url.origin === plexOrigin) {
      url.searchParams.set('X-Plex-Token', config.plex.token)
    }
    const upstream = await fetch(url, {
      dispatcher: plexDispatcher,
      signal: AbortSignal.timeout(15_000),
    } as RequestInit & { dispatcher: typeof plexDispatcher })
    if (!upstream.ok) {
      await cancelResponseBody(upstream)
      throw new Error(`Plex image returned ${upstream.status}`)
    }
    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      await cancelResponseBody(upstream)
      return res.status(502).json({ error: 'Plex artwork response was not an image' })
    }
    const declaredLength = Number(upstream.headers.get('content-length')) || 0
    if (declaredLength > 10 * 1024 * 1024) {
      await cancelResponseBody(upstream)
      return res.status(413).json({ error: 'Plex artwork is too large' })
    }
    const bytes = await readBoundedResponseBody(upstream, 10 * 1024 * 1024)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'private, max-age=300')
    res.send(bytes)
  } catch (error) {
    if (error instanceof Error && error.message === 'RESPONSE_BODY_TOO_LARGE') {
      return res.status(413).json({ error: 'Plex artwork is too large' })
    }
    fail(res, 'Failed to fetch Plex image', error)
  }
})

router.post('/api/plex/playlists', async (req, res) => {
  const { title, type = 'video', smart = 0, uri } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'Playlist title is required' })
  try {
    const formData: Record<string, string> = { title, type, smart: String(smart) }
    if (uri) formData.uri = uri
    res.json(await plexJson('/playlists', { method: 'POST', formData }))
  } catch (error) {
    fail(res, 'Failed to create Plex playlist', error)
  }
})

router.put('/api/plex/playlists/:playlistId/items', async (req, res) => {
  const playlistId = requestId(req.params.playlistId, 'playlist id', res)
  if (!playlistId) return
  const uri = req.body?.uri
  if (!uri) return res.status(400).json({ error: 'URI is required to add items to playlist' })
  try {
    res.json(await plexJson(
      `/playlists/${playlistId}/items?uri=${encodeURIComponent(uri)}`,
      { method: 'PUT' },
    ))
  } catch (error) {
    fail(res, 'Failed to add items to Plex playlist', error)
  }
})

router.get('/api/plex/playlists', async (_req, res) => {
  try { res.json(sanitizeMediaPaths(await plexJson('/playlists'))) } catch (error) {
    fail(res, 'Failed to fetch Plex playlists', error)
  }
})

router.get('/api/plex/playlists/:playlistId/items', async (req, res) => {
  const playlistId = requestId(req.params.playlistId, 'playlist id', res)
  if (!playlistId) return
  try { res.json(sanitizeMediaPaths(await plexJson(`/playlists/${playlistId}/items`))) } catch (error) {
    fail(res, 'Failed to fetch Plex playlist items', error)
  }
})

router.get('/api/plex/library/:sectionId/playlists', async (req, res) => {
  const sectionId = requestId(req.params.sectionId, 'section id', res)
  if (!sectionId) return
  try {
    const playlistType = String(req.query.type || 'video')
    const all = await plexJson(`/playlists?playlistType=${encodeURIComponent(playlistType)}`)
    const playlists: any[] = all?.MediaContainer?.Metadata ?? []
    const results = await Promise.all(playlists.map(async (playlist) => {
      try {
        const playlistId = canonicalPlexId(String(playlist.ratingKey))
        if (!playlistId) return null
        const data = await plexJson(`/playlists/${playlistId}/items`)
        const items: any[] = data?.MediaContainer?.Metadata ?? []
        const inSection = items.filter((item) => String(item.librarySectionID) === sectionId)
        return inSection.length ? {
          ratingKey: playlist.ratingKey,
          title: playlist.title,
          summary: playlist.summary,
          playlistType: playlist.playlistType,
          smart: playlist.smart === '1' || playlist.smart === 1,
          totalItems: items.length,
          itemsInLibrary: inSection.length,
          duration: Number(playlist.duration ?? 0),
          addedAt: Number(playlist.addedAt ?? 0),
          updatedAt: Number(playlist.updatedAt ?? 0),
          thumb: playlist.composite || playlist.thumb || null,
        } : null
      } catch {
        return null
      }
    }))
    const filtered = results.filter((item): item is NonNullable<typeof item> => Boolean(item))
    filtered.sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt))
    res.json({ playlists: filtered })
  } catch (error) {
    fail(res, 'Failed to fetch library playlists', error)
  }
})

router.post('/api/plex/collections', async (req, res) => {
  const { title, type = 'movie', sectionId, summary, uri } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'Collection title is required' })
  const canonicalSectionId = requestId(String(sectionId ?? ''), 'section id', res)
  if (!canonicalSectionId) return
  try {
    const formData: Record<string, string> = { title, type }
    if (summary) formData.summary = summary
    if (uri) formData.uri = uri
    res.json(await plexJson(`/library/sections/${canonicalSectionId}/collections`, {
      method: 'POST',
      formData,
    }))
  } catch (error) {
    fail(res, 'Failed to create Plex collection', error)
  }
})

router.put('/api/plex/collections/:collectionId/items', async (req, res) => {
  const collectionId = requestId(req.params.collectionId, 'collection id', res)
  if (!collectionId) return
  const uri = req.body?.uri
  if (!uri) return res.status(400).json({ error: 'URI is required to add items to collection' })
  try {
    res.json(await plexJson(
      `/library/collections/${collectionId}/items?uri=${encodeURIComponent(uri)}`,
      { method: 'PUT' },
    ))
  } catch (error) {
    fail(res, 'Failed to add items to Plex collection', error)
  }
})

router.put('/api/plex/collections/:collectionId', async (req, res) => {
  const collectionId = requestId(req.params.collectionId, 'collection id', res)
  if (!collectionId) return
  const formData: Record<string, string> = {}
  if (req.body?.title) formData.title = req.body.title
  if (req.body?.summary) formData.summary = req.body.summary
  try {
    res.json(await plexJson(`/library/collections/${collectionId}`, {
      method: 'PUT',
      formData,
    }))
  } catch (error) {
    fail(res, 'Failed to update Plex collection', error)
  }
})

router.get('/api/plex/sections/:sectionId/collections', async (req, res) => {
  const sectionId = requestId(req.params.sectionId, 'section id', res)
  if (!sectionId) return
  try { res.json(sanitizeMediaPaths(await plexJson(`/library/sections/${sectionId}/collections`))) } catch (error) {
    fail(res, 'Failed to fetch Plex collections', error)
  }
})

router.get('/api/plex/collections/:collectionId', async (req, res) => {
  const collectionId = requestId(req.params.collectionId, 'collection id', res)
  if (!collectionId) return
  try { res.json(sanitizeMediaPaths(await plexJson(`/library/collections/${collectionId}/children`))) } catch (error) {
    fail(res, 'Failed to fetch Plex collection details', error)
  }
})

router.get('/api/plex/sections', async (_req, res) => {
  try { res.json(sanitizeMediaPaths(await plexJson('/library/sections'))) } catch (error) {
    fail(res, 'Failed to fetch Plex library sections', error)
  }
})

router.get('/api/plex/sections/:key/all', async (req, res) => {
  const sectionId = requestId(req.params.key, 'section id', res)
  if (!sectionId) return
  try { res.json(sanitizeMediaPaths(await plexJson(`/library/sections/${sectionId}/all`))) } catch (error) {
    fail(res, 'Failed to fetch Plex library section content', error)
  }
})

router.get('/api/plex/search', async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
  const type = typeof req.query.type === 'string' ? req.query.type : 'movie'
  if (!query) return res.status(400).json({ error: 'Search query is required' })
  try {
    const sectionsData = await plexJson('/library/sections')
    const sections: any[] = (sectionsData.MediaContainer?.Directory ?? [])
      .filter((section: any) => section.type === type)
    const movies: any[] = []
    for (const section of sections) {
      try {
        const sectionId = requireCanonicalPlexId(String(section.key), 'Plex section id')
        const search = await plexJson(
          `/library/sections/${sectionId}/search?query=${encodeURIComponent(query)}`,
        )
        for (const movie of search.MediaContainer?.Metadata ?? []) {
          movies.push({
            title: movie.title,
            year: movie.year,
            key: movie.key,
            guid: movie.guid,
            ratingKey: movie.ratingKey,
            section: section.title,
          })
        }
      } catch {
        // Production behavior treats a single section failure as partial search.
      }
    }
    res.json({ movies })
  } catch (error) {
    fail(res, 'Failed to search Plex library', error)
  }
})

router.get('/api/plex/stats', async (_req, res) => {
  try {
    const sectionData = await plexJson('/library/sections')
    const sections: any[] = sectionData.MediaContainer?.Directory ?? []
    const libraries = await Promise.all(sections.map(async (section: any) => {
      try {
        const sectionId = requireCanonicalPlexId(String(section.key), 'Plex section id')
        const content = await plexJson(`/library/sections/${sectionId}/all`)
        return {
          key: section.key,
          title: section.title,
          type: section.type,
          count: content.MediaContainer?.size || 0,
          uuid: section.uuid,
        }
      } catch {
        return { key: section.key, title: section.title, type: section.type, count: 0, error: 'Failed to fetch count' }
      }
    }))
    res.json({ libraries })
  } catch (error) {
    fail(res, 'Failed to fetch Plex library statistics', error)
  }
})

router.get('/api/movie/details', async (req, res) => {
  const title = typeof req.query.title === 'string' ? req.query.title : ''
  const year = typeof req.query.year === 'string' ? req.query.year : undefined
  if (!title) return res.status(400).json({ error: 'Movie title is required' })
  try {
    const movie = await movieDetails(title, year)
    if (movie.Error) return res.status(404).json({ error: `Movie not found: ${movie.Error}` })
    res.json({
      title: movie.Title, year: movie.Year, rated: movie.Rated, released: movie.Released,
      runtime: movie.Runtime, genre: movie.Genre, director: movie.Director, writer: movie.Writer,
      actors: movie.Actors, plot: movie.Plot, language: movie.Language, country: movie.Country,
      awards: movie.Awards, poster: movie.Poster, imdbRating: movie.imdbRating,
      imdbVotes: movie.imdbVotes, boxOffice: movie.BoxOffice, production: movie.Production,
    })
  } catch (error) {
    fail(res, 'Failed to fetch movie details from external source', error)
  }
})

export default router
