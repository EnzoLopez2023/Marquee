import { Router } from 'express'
import { anthropic } from '../clients/anthropic.js'
import { tautulliApi } from '../clients/tautulli.js'
import { config } from '../config.js'
import { isPlexArtworkPath } from '../domain/media/sanitize.js'
import {
  cancelResponseBody,
  readBoundedResponseBody,
} from '../domain/media/boundedBody.js'

const router = Router()
const unavailable = (res: any) => res.status(503).json({ error: 'Tautulli not configured' })
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const query = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback
export const isAllowedTautulliImagePath = isPlexArtworkPath

export function boundedImageDimension(value: unknown, fallback: number) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (!/^[1-9]\d*$/.test(text)) return value == null ? fallback : null
  const parsed = Number(text)
  return parsed <= 2_000 ? parsed : null
}

router.get('/api/tautulli/status', (_req, res) => {
  res.json({ configured: Boolean(config.tautulli.apiKey), url: config.tautulli.url })
})

const direct = [
  ['/api/tautulli/activity', 'get_activity'],
  ['/api/tautulli/plays-by-date', 'get_plays_by_date'],
  ['/api/tautulli/plays-by-dayofweek', 'get_plays_by_dayofweek'],
  ['/api/tautulli/plays-by-hourofday', 'get_plays_by_hourofday'],
  ['/api/tautulli/plays-by-platform', 'get_plays_by_top_10_platforms'],
] as const
for (const [routePath, command] of direct) {
  router.get(routePath, async (req, res) => {
    if (!config.tautulli.apiKey) return unavailable(res)
    try {
      const parameters: Record<string, string | number | boolean> = routePath.endsWith('activity')
        ? {}
        : { time_range: query(req.query.days, '30') }
      res.json(await tautulliApi(command, parameters))
    } catch (error) {
      res.status(502).json({ error: message(error) })
    }
  })
}

router.get('/api/tautulli/home-stats', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  try {
    res.json(await tautulliApi('get_home_stats', {
      time_range: query(req.query.days, '30'),
      stats_count: 10,
    }))
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/libraries', async (_req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  try {
    const result = await tautulliApi<any>('get_libraries_table', {
      length: 100, order_column: 'section_name', order_dir: 'asc',
    })
    res.json(result.data)
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

for (const [suffix, command] of [
  ['watch-stats', 'get_library_watch_time_stats'],
  ['user-stats', 'get_library_user_stats'],
] as const) {
  router.get(`/api/tautulli/library/:id/${suffix}`, async (req, res) => {
    if (!config.tautulli.apiKey) return unavailable(res)
    try { res.json(await tautulliApi(command, { section_id: req.params.id })) } catch (error) {
      res.status(502).json({ error: message(error) })
    }
  })
}

router.get('/api/tautulli/library/:id/recently-added', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  try {
    const result = await tautulliApi<any>('get_recently_added', {
      section_id: req.params.id, count: 12,
    })
    res.json(result?.recently_added ?? result ?? [])
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/library/:id/history', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const page = Math.max(1, Number(query(req.query.page, '1')) || 1)
  const length = Math.min(100, Math.max(1, Number(query(req.query.length, '25')) || 25))
  try {
    const result = await tautulliApi<any>('get_history', {
      section_id: req.params.id, length, start: (page - 1) * length,
    })
    res.json({ total: result.recordsFiltered, data: result.data })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/library/:id/media-info', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const page = Math.max(1, Number(query(req.query.page, '1')) || 1)
  const length = Math.min(100, Math.max(1, Number(query(req.query.length, '25')) || 25))
  const parameters: Record<string, string | number | boolean> = {
    section_id: req.params.id, length, start: (page - 1) * length,
    order_column: 'added_at', order_dir: 'desc',
  }
  if (req.query.refresh === '1' || req.query.refresh === 'true') parameters.refresh = true
  try {
    const result = await tautulliApi<any>('get_library_media_info', parameters)
    res.json({ total: result.recordsFiltered ?? 0, data: result.data ?? [] })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/history', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const page = Math.max(1, Number(query(req.query.page, '1')) || 1)
  const length = Math.min(100, Math.max(1, Number(query(req.query.length, '25')) || 25))
  const parameters: Record<string, string | number> = { length, start: (page - 1) * length }
  if (typeof req.query.user === 'string' && req.query.user) parameters.user = req.query.user
  if (typeof req.query.media_type === 'string' && req.query.media_type) {
    parameters.media_type = req.query.media_type
  }
  try {
    const result = await tautulliApi<any>('get_history', parameters)
    res.json({ total: result.recordsFiltered, data: result.data })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/image', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const image = query(req.query.img, '')
  if (!isAllowedTautulliImagePath(image)) {
    return res.status(400).json({ error: 'Invalid relative Plex artwork path' })
  }
  const width = boundedImageDimension(req.query.width, 150)
  const height = boundedImageDimension(req.query.height, 225)
  if (!width || !height) return res.status(400).json({ error: 'Invalid image dimensions' })
  const fallback = query(req.query.fallback, 'poster')
  if (!['poster', 'cover', 'art'].includes(fallback)) {
    return res.status(400).json({ error: 'Invalid image fallback' })
  }
  const url = new URL('/api/v2', config.tautulli.url)
  const parameters = {
    apikey: config.tautulli.apiKey,
    cmd: 'pms_image_proxy',
    img: image,
    width: String(width),
    height: String(height),
    fallback,
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!upstream.ok) {
      await cancelResponseBody(upstream)
      return res.status(upstream.status).end()
    }
    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      await cancelResponseBody(upstream)
      return res.status(502).json({ error: 'Tautulli artwork response was not an image' })
    }
    const declaredLength = Number(upstream.headers.get('content-length')) || 0
    if (declaredLength > 10 * 1024 * 1024) {
      await cancelResponseBody(upstream)
      return res.status(413).json({ error: 'Tautulli artwork is too large' })
    }
    const bytes = await readBoundedResponseBody(upstream, 10 * 1024 * 1024)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader('Cache-Control', 'private, max-age=86400')
    return res.send(bytes)
  } catch (error) {
    if (error instanceof Error && error.message === 'RESPONSE_BODY_TOO_LARGE') {
      return res.status(413).json({ error: 'Tautulli artwork is too large' })
    }
    return res.status(502).json({ error: message(error) })
  }
})

router.get('/api/tautulli/ai-insights', async (_req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  if (!anthropic) return res.status(503).json({ error: 'Anthropic not configured' })
  try {
    const [homeStats, playsHod, playsDow, libraries] = await Promise.all([
      tautulliApi<any[]>('get_home_stats', { time_range: 30, stats_count: 5 }),
      tautulliApi<any>('get_plays_by_hourofday', { time_range: 30 }),
      tautulliApi<any>('get_plays_by_dayofweek', { time_range: 30 }),
      tautulliApi<any>('get_libraries_table', { length: 20, order_column: 'plays', order_dir: 'desc' }),
    ])
    const context = JSON.stringify({
      homeStats,
      playsByHour: playsHod,
      playsByDay: playsDow,
      libraries: libraries?.data ?? [],
    }).slice(0, 50_000)
    const answer = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Return exactly four witty Plex insights as a JSON array of strings, each at most 22 words. Use only this data:\n${context}`,
      }],
    })
    const raw = answer.content[0]?.type === 'text' ? answer.content[0].text : '[]'
    const match = raw.match(/\[[\s\S]*?\]/)
    let insights: string[] = []
    try { insights = match ? JSON.parse(match[0]) as string[] : [] } catch { insights = [] }
    res.json({ insights, generated_at: new Date().toISOString() })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/cool-facts', async (_req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  try {
    const [stats, dates] = await Promise.all([
      tautulliApi<any[]>('get_home_stats', { time_range: 9999, stats_count: 10 }),
      tautulliApi<any>('get_plays_by_date', { time_range: 1095 }),
    ])
    const rows = (id: string) => stats?.find((item) => item.stat_id === id)?.rows ?? []
    const topMovies = rows('top_movies').slice(0, 5)
    const topTV = rows('top_tv').slice(0, 5)
    const topUsers = rows('top_users').slice(0, 4)
    const lastWatched = rows('last_watched').slice(0, 6)
    const totals = (dates?.categories ?? []).map((date: string, index: number) => ({
      date,
      plays: (dates?.series ?? []).reduce(
        (sum: number, series: any) => sum + Number(series.data?.[index] ?? 0),
        0,
      ),
    }))
    const peakDay = totals.reduce(
      (highest: any, item: any) => item.plays > highest.plays ? item : highest,
      { date: '', plays: 0 },
    )
    res.json({
      topMovies, topTV, topUsers, lastWatched,
      userMediaBreakdown: {}, topGenres: [], peakDay,
    })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/users', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  try {
    const data = await tautulliApi<any>('get_users_table', {
      length: 100,
      order_column: query(req.query.sort, 'friendly_name'),
      order_dir: query(req.query.dir, 'asc'),
    })
    const users = data?.data ?? (Array.isArray(data) ? data : [])
    res.json({ users, total: data?.recordsTotal ?? users.length })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

router.get('/api/tautulli/users/:userId', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const userId = req.params.userId
  const [profile, watchStats, playerStats, recentlyWatched] = await Promise.all([
    tautulliApi('get_user', { user_id: userId }).catch(() => null),
    tautulliApi('get_user_watch_time_stats', { user_id: userId }).catch(() => []),
    tautulliApi('get_user_player_stats', { user_id: userId }).catch(() => []),
    tautulliApi<any>('get_history', {
      user_id: userId, length: 20, order_column: 'date', order_dir: 'desc',
    }).catch(() => null),
  ])
  res.json({
    profile,
    watchStats: Array.isArray(watchStats) ? watchStats : [],
    playerStats: Array.isArray(playerStats) ? playerStats : [],
    recentlyWatched: recentlyWatched?.data ?? (Array.isArray(recentlyWatched) ? recentlyWatched : []),
  })
})

router.get('/api/tautulli/users/:userId/history', async (req, res) => {
  if (!config.tautulli.apiKey) return unavailable(res)
  const length = Math.min(100, Math.max(1, Number(query(req.query.length, '25')) || 25))
  const page = Math.max(1, Number(query(req.query.page, '1')) || 1)
  try {
    const data = await tautulliApi<any>('get_history', {
      user_id: req.params.userId,
      length,
      start: (page - 1) * length,
      order_column: 'date',
      order_dir: 'desc',
    })
    res.json({ rows: data?.data ?? [], total: data?.recordsFiltered ?? 0 })
  } catch (error) { res.status(502).json({ error: message(error) }) }
})

for (const [source, command] of [
  ['tautulli', 'get_logs'],
  ['plex', 'get_plex_log'],
  ['notifications', 'get_notification_log'],
] as const) {
  router.get(`/api/tautulli/logs/${source}`, async (req, res) => {
    if (!config.tautulli.apiKey) return unavailable(res)
    const rows = Math.min(Number(query(req.query.rows, '500')) || 500, 2_000)
    try {
      const data = await tautulliApi<any>(command, {
        order: req.query.order === 'asc' ? 'asc' : 'desc',
        rows_per_page: rows,
        ...(req.query.search ? { search: query(req.query.search, '') } : {}),
      })
      const entries = Array.isArray(data) ? data : data?.data ?? []
      res.json({ source, total: entries.length, entries })
    } catch (error) { res.status(502).json({ error: message(error) }) }
  })
}

export default router
