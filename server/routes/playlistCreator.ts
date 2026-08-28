import { Router } from 'express'
import { plexFetch, plexJson, plexText } from '../clients/plex.js'
import { playlistCompletion } from '../clients/playlistModel.js'
import { canonicalPlexId } from '../domain/media/plexId.js'

const router = Router()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const sse = (req: any, res: any) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write(`:${' '.repeat(2048)}\n\n:ok\n\n`)
  const send = (type: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
    res.flush?.()
  }
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000)
  req.on('close', () => clearInterval(heartbeat))
  return { send, stop: () => clearInterval(heartbeat) }
}

router.post('/api/playlist-creator/search-collection', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
  if (!query) return res.status(400).json({ error: 'Query is required' })
  try {
    const data = await playlistCompletion([
      {
        role: 'system',
        content: 'Return a comprehensive movie franchise as JSON: {"movies":[{"title":"Exact title","year":2020,"director":"Name"}]}. Include sequels, prequels, and canonical spin-offs.',
      },
      { role: 'user', content: `List every movie in the "${query}" collection or series.` },
    ])
    const content = String(data?.choices?.[0]?.message?.content || '')
    const match = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[1] || match?.[0] || content)
    if (!Array.isArray(parsed.movies)) throw new Error('Invalid movie data format from playlist model')
    res.json({ movies: parsed.movies.slice(0, 250) })
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) })
  }
})

const decode = (value: string) => value
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')

function parseMovieXml(xml: string) {
  return (xml.match(/<Video[^>]*>/g) || []).flatMap((tag) => {
    const attribute = (name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]
    const title = attribute('title')
    const year = attribute('year')
    const ratingKey = attribute('ratingKey')
    const mediaId = canonicalPlexId(ratingKey)
    if (!title || !year || !mediaId) return []
    return [{
      title: decode(title),
      year: Number(year),
      ratingKey: mediaId,
      key: attribute('key') || '',
      guid: attribute('guid') || '',
      section: decode(attribute('librarySectionTitle') || 'Unknown'),
    }]
  })
}

async function matchMovie(movie: any) {
  const candidates = [String(movie.title)]
  if (movie.title.includes(' 2')) candidates.push(movie.title.replace(' 2', ' II'))
  else if (movie.title.includes(' II')) candidates.push(movie.title.replace(' II', ' 2'))
  for (const title of candidates) {
    const results = parseMovieXml(await plexText(`/search?query=${encodeURIComponent(title)}`))
    const matches = results.filter((item) => (
      item.title.toLowerCase() === title.toLowerCase()
      && (!movie.year || Math.abs(item.year - Number(movie.year)) <= 1)
    ))
    const match = matches.find((item) => item.section === 'ALL Movies') || matches[0]
    if (match) return match
  }
  return null
}

router.post('/api/playlist-creator/process-movies', async (req, res) => {
  const movies = Array.isArray(req.body?.movies) ? req.body.movies.slice(0, 250) : null
  if (!movies) return res.status(400).json({ error: 'Movies array is required' })
  const stream = sse(req, res)
  const found: any[] = []
  stream.send('log', { message: `Searching for ${movies.length} movies...`, logType: 'info' })
  for (const [index, movie] of movies.entries()) {
    stream.send('log', {
      message: `[${index + 1}/${movies.length}] Searching for "${movie.title}" (${movie.year})...`,
      logType: 'info',
    })
    try {
      const matched = await matchMovie(movie)
      if (matched) {
        found.push(matched)
        stream.send('movie_found', { movie: matched })
        stream.send('log', { message: `Found "${matched.title}" (${matched.year})`, logType: 'success' })
      } else {
        stream.send('log', { message: `Not found: "${movie.title}" (${movie.year})`, logType: 'error' })
      }
    } catch (error) {
      stream.send('log', { message: `Search failed: ${errorMessage(error)}`, logType: 'error' })
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  stream.send('complete', { totalFound: found.length, movies: found })
  stream.stop()
  res.end()
})

router.post('/api/playlist-creator/create-playlist', async (req, res) => {
  const requestedMovies = Array.isArray(req.body?.movies) ? req.body.movies.slice(0, 250) : []
  if (!requestedMovies.length) {
    return res.status(400).json({ error: 'Movies array is required and cannot be empty' })
  }
  const movies = requestedMovies.map((movie: any) => ({
    ...movie,
    ratingKey: canonicalPlexId(String(movie?.ratingKey ?? '')),
  }))
  if (movies.some((movie: any) => !movie.ratingKey)) {
    return res.status(400).json({ error: 'Movie rating keys must be canonical positive integers' })
  }
  const stream = sse(req, res)
  let title = String(req.body?.originalQuery || 'Marquee Picks').slice(0, 120)
  try {
    const result = await playlistCompletion([
      { role: 'system', content: 'Return only a creative two-to-six word movie playlist title.' },
      { role: 'user', content: `Theme: ${title}. Movies: ${movies.slice(0, 3).map((movie: any) => movie.title).join(', ')}` },
    ])
    title = String(result?.choices?.[0]?.message?.content || title).trim().replace(/['"]/g, '')
    stream.send('title_generated', { title })
  } catch {
    stream.send('log', { message: `Using playlist title "${title}"`, logType: 'warning' })
  }

  try {
    const root = await plexJson<any>('/')
    const machineId = root.MediaContainer?.machineIdentifier
    if (!machineId) throw new Error('Plex machine identifier is unavailable')
    const uri = (movie: any) => `library://${machineId}/item/library/metadata/${movie.ratingKey}`
    const response = await plexFetch(
      `/playlists?type=video&title=${encodeURIComponent(title)}&smart=0&uri=${encodeURIComponent(uri(movies[0]))}`,
      { method: 'POST', accept: 'xml' },
    )
    if (!response.ok) throw new Error(`Failed to create playlist (${response.status})`)
    const text = await response.text()
    let playlistId: string | undefined
    try {
      const json = JSON.parse(text)
      playlistId = canonicalPlexId(String(json.MediaContainer?.Playlist?.[0]?.ratingKey || '')) || undefined
    } catch {
      playlistId = text.match(/ratingKey="(\d+)"/)?.[1]
    }
    if (!playlistId) throw new Error('Plex did not return a playlist id')
    stream.send('playlist_created', { playlistId })
    let addedCount = 1
    const failedTitles: string[] = []
    for (const [index, movie] of movies.slice(1).entries()) {
      const add = await plexFetch(
        `/playlists/${playlistId}/items?uri=${encodeURIComponent(uri(movie))}`,
        { method: 'PUT' },
      )
      stream.send('log', {
        message: add.ok ? `Added "${movie.title}"` : `Failed to add "${movie.title}" (${add.status})`,
        logType: add.ok ? 'success' : 'error',
      })
      if (add.ok) addedCount += 1
      else failedTitles.push(String(movie.title))
      if (index % 10 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
    if (failedTitles.length) {
      stream.send('log', {
        message: `${failedTitles.length} movie${failedTitles.length === 1 ? '' : 's'} could not be added.`,
        logType: 'warning',
      })
    }
    stream.send('complete', {
      playlistId,
      title,
      movieCount: addedCount,
      requestedMovieCount: movies.length,
      partial: failedTitles.length > 0,
      failedTitles,
    })
  } catch (error) {
    stream.send('error', { message: errorMessage(error) })
  } finally {
    stream.stop()
    res.end()
  }
})

export default router
