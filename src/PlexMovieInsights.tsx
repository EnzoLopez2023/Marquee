import { apiClient } from './services/apiClient'
// Plex library browser. Lists movies via the backend proxy, supports search +
// random pick, surfaces aggregate stats, and shows per-movie technical specs
// (codec, resolution, audio channels, bitrate). Detail view backed by the
// Plex metadata; OMDb cross-references happen via the AI chat flow.

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Box, Typography, Chip, Button, TextField, InputAdornment, Select, MenuItem,
  FormControl, Card, CardContent, Stack, Tooltip, Popover, ToggleButton,
  ToggleButtonGroup, Divider,
} from '@mui/material'
import {
  ArrowBack as ArrowLeft,
  Movie as MovieIcon,
  Shuffle,
  Search,
  VideoLibrary,
  PlaylistAdd as PlaylistAddIcon,
  Star as StarIcon,
  AccessTime as TimeIcon,
  CalendarMonth as CalendarIcon,
  FilterAlt as FilterIcon,
  Sort as SortIcon,
} from './components/AppIcons'
import { logger } from './utils/logger'
import { getApiBaseUrl } from './utils/apiBaseUrl'
import { useAuthenticatedImageUrl } from './services/authenticatedImage'
import { useThemeMode } from './context/ThemeContext'
import { useReadOnly } from './context/UserPermissionsContext'
import { tokensFor } from './theme/tokens'
import { withAlpha } from './theme/contrast'
import PageHero from './components/PageHero'
import { CARD_HOVER_SX, onAccent, accentHover, CARD_RADIUS, pageShellSx } from './theme/controls';
import PlaylistBuilderDialog from './components/PlaylistBuilderDialog'

// ── Types ───────────────────────────────────────────────────────────────────

interface PlexMedia {
  id: number
  duration: number
  bitrate: number
  width: number
  height: number
  aspectRatio: number
  audioChannels: number
  audioCodec: string
  videoCodec: string
  videoResolution: string
  container: string
  videoFrameRate: string
}

interface PlexImage {
  alt: string
  type: string
  url: string
}

interface PlexGenre { tag: string }
interface PlexPerson { tag: string }

interface PlexMovie {
  ratingKey: string
  key: string
  guid: string
  slug?: string
  studio?: string
  type: string
  title: string
  contentRating?: string
  summary: string
  rating?: number
  audienceRating?: number
  viewCount?: number
  lastViewedAt?: number
  year: number
  tagline?: string
  thumb: string
  art: string
  duration: number
  originallyAvailableAt: string
  addedAt: number
  updatedAt: number
  Media?: PlexMedia[]
  Image?: PlexImage[]
  Genre?: PlexGenre[]
  Country?: PlexPerson[]
  Director?: PlexPerson[]
  Writer?: PlexPerson[]
  Role?: PlexPerson[]
}

interface PlexResponse {
  MediaContainer: { size: number; librarySectionTitle: string; Metadata: PlexMovie[] }
}

interface PlexLibrary {
  key: string
  title: string
  type: string
  uuid: string
}

interface PlexSectionsResponse {
  MediaContainer: { Directory: PlexLibrary[] }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatDuration = (ms: number) => {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${m}m`
}

// Long-form runtime for the stats card: "5d 12h 30m" or "12h 30m" or "30m".
const formatTotalRuntime = (ms: number) => {
  if (ms <= 0) return '—'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// Plex returns resolution as lower-case strings like "4k", "1080", "720", "sd".
type ResolutionTier = '4K' | '1080p' | '720p' | '480p' | 'SD'
const getResolutionTier = (res?: string): ResolutionTier => {
  if (!res) return 'SD'
  const v = res.toLowerCase()
  if (v.includes('4k') || v === '2160') return '4K'
  if (v.includes('1080')) return '1080p'
  if (v.includes('720')) return '720p'
  if (v.includes('480')) return '480p'
  return 'SD'
}

const formatBitrate = (kbps?: number) => {
  if (!kbps) return null
  const mbps = kbps / 1000
  return mbps >= 10 ? `${mbps.toFixed(1)} Mbps` : `${mbps.toFixed(2)} Mbps`
}

const normaliseCodec = (c?: string) =>
  !c ? '—' : c.toLowerCase() === 'hevc' ? 'H.265' : c.toLowerCase() === 'h264' ? 'H.264' : c.toUpperCase()

const audioChannelLabel = (n?: number) => {
  if (!n) return null
  if (n === 1) return '1.0'
  if (n === 2) return '2.0'
  if (n === 6) return '5.1'
  if (n === 8) return '7.1'
  return `${n}ch`
}

// ── Sort + Filter types ────────────────────────────────────────────────────

type SortKey =
  | 'added-desc'        // Default: newest in library first
  | 'added-asc'         // Oldest in library first
  | 'title-asc' | 'title-desc'
  | 'year-desc' | 'year-asc'
  | 'last-viewed-desc'  // Most recently watched first
  | 'view-count-desc' | 'view-count-asc'
  | 'rating-desc'       // Highest critic score first
  | 'duration-desc' | 'duration-asc'

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'added-desc',       label: 'Date added · newest' },
  { key: 'added-asc',        label: 'Date added · oldest' },
  { key: 'title-asc',        label: 'Title · A → Z' },
  { key: 'title-desc',       label: 'Title · Z → A' },
  { key: 'year-desc',        label: 'Release year · newest' },
  { key: 'year-asc',         label: 'Release year · oldest' },
  { key: 'last-viewed-desc', label: 'Recently watched' },
  { key: 'view-count-desc',  label: 'Most viewed' },
  { key: 'view-count-asc',   label: 'Least viewed' },
  { key: 'rating-desc',      label: 'Highest rated' },
  { key: 'duration-desc',    label: 'Runtime · longest' },
  { key: 'duration-asc',     label: 'Runtime · shortest' },
]

type WatchedFilter = 'all' | 'watched' | 'unwatched'

interface Filters {
  watched: WatchedFilter
  genres: string[]
  mpaa: string[]
  decades: string[]            // e.g. '2010s', '2020s'
  resolutions: ResolutionTier[]
}

const EMPTY_FILTERS: Filters = {
  watched: 'all',
  genres: [],
  mpaa: [],
  decades: [],
  resolutions: [],
}

// '2014' → '2010s'
const decadeOfYear = (year?: number): string | null => {
  if (!year || year < 1880) return null
  return `${Math.floor(year / 10) * 10}s`
}

// Total number of selected filter values (for the Filter button badge).
// Counts each chip rather than each group, so "Action+Drama+PG-13" reads as 3.
const countActiveFilters = (f: Filters): number => {
  let n = 0
  if (f.watched !== 'all') n += 1
  n += f.genres.length + f.mpaa.length + f.decades.length + f.resolutions.length
  return n
}

// Comparator factory keyed by SortKey. Movies missing the sort field always
// sink to the bottom of the list regardless of asc/desc, so "least viewed"
// doesn't bury the actually-watched movies under a wall of zero-view items
// (and "recently watched" doesn't put never-watched items at the top).
const makeComparator = (key: SortKey) => (a: PlexMovie, b: PlexMovie): number => {
  const sinkUndef = (av: number | string | undefined | null, bv: number | string | undefined | null) => {
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return 0
  }
  switch (key) {
    case 'added-desc':       return (b.addedAt || 0) - (a.addedAt || 0)
    case 'added-asc':        return (a.addedAt || 0) - (b.addedAt || 0)
    case 'title-asc':        return (a.title || '').localeCompare(b.title || '')
    case 'title-desc':       return (b.title || '').localeCompare(a.title || '')
    case 'year-desc':        return (b.year || 0) - (a.year || 0)
    case 'year-asc':         return (a.year || 0) - (b.year || 0)
    case 'last-viewed-desc': {
      const sink = sinkUndef(a.lastViewedAt, b.lastViewedAt)
      if (sink !== 0) return sink
      return (b.lastViewedAt || 0) - (a.lastViewedAt || 0)
    }
    case 'view-count-desc':  return (b.viewCount || 0) - (a.viewCount || 0)
    case 'view-count-asc':   return (a.viewCount || 0) - (b.viewCount || 0)
    case 'rating-desc': {
      const sink = sinkUndef(a.rating, b.rating)
      if (sink !== 0) return sink
      return (b.rating || 0) - (a.rating || 0)
    }
    case 'duration-desc':    return (b.duration || 0) - (a.duration || 0)
    case 'duration-asc':     return (a.duration || 0) - (b.duration || 0)
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PlexMovieInsights() {
  const { mode, palette } = useThemeMode()
  const isDark = mode === 'dark'
  const readOnly = useReadOnly('halloween')

  // Page chrome from the tokens in force rather than hard-coded Wine Cellar hex,
  // so the palette, accent and text colour pinned to this page reach it.
  // SAGE / ACCENT_4K / ACCENT_HDR are visualization-specific (resolution/HDR
  // badges) and stay as their own brand colors, distinct from the page palette.
  const t        = tokensFor(isDark, palette)
  const BG       = t.bg
  const SURFACE  = t.surface
  const PAPER    = t.paper
  const BORDER   = t.line
  const INK      = t.ink
  const MUTED    = t.muted
  const RUST     = isDark ? t.rustLight : t.rustDark
  const RUST_BG  = withAlpha(RUST, isDark ? 0.14 : 0.08)
  const SAGE     = isDark ? '#8FA876' : '#6B8657'
  const ACCENT_4K  = isDark ? '#7BA9D6' : '#4A7AAB'
  const MONO = '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, monospace'
  const SERIF = 'var(--hearth-heading)'

  const [movies, setMovies] = useState<PlexMovie[]>([])
  const [libraries, setLibraries] = useState<PlexLibrary[]>([])
  const [selectedLibrary, setSelectedLibrary] = useState<string>('')
  const [selectedMovie, setSelectedMovie] = useState<PlexMovie | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingLibraries, setLoadingLibraries] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showMobileDetails, setShowMobileDetails] = useState(false)
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false)
  const [lastScan, setLastScan] = useState<Date | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('added-desc')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const selectedArtUrl = useAuthenticatedImageUrl(
    selectedMovie?.art
      ? `${apiBaseUrl}/plex/image?path=${encodeURIComponent(selectedMovie.art)}`
      : null,
  )

  const fetchLibraries = useCallback(async () => {
    try {
      setLoadingLibraries(true)
      const response = await apiClient.fetch(`${apiBaseUrl}/plex/sections`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

      const data: PlexSectionsResponse = await response.json()
      const movieLibraries = (data.MediaContainer.Directory || [])
        .filter(library => library.type.toLowerCase() === 'movie')

      logger.debug(`Found ${movieLibraries.length} movie libraries`)
      setLibraries(movieLibraries)
      if (movieLibraries.length > 0) setSelectedLibrary(movieLibraries[0].key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch libraries')
      logger.error('Error fetching libraries:', err)
    } finally {
      setLoadingLibraries(false)
    }
  }, [apiBaseUrl])

  const fetchMovies = useCallback(async (libraryKey: string) => {
    if (!libraryKey) return
    try {
      setLoading(true)
      setError(null)
      const response = await apiClient.fetch(`${apiBaseUrl}/plex/sections/${libraryKey}/all`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

      const data: PlexResponse = await response.json()
      const list = data.MediaContainer.Metadata || []
      setMovies(list)
      setSelectedMovie(list[0] || null)
      setLastScan(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch movies')
      logger.error('Error fetching movies:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl])

  useEffect(() => { fetchLibraries() }, [fetchLibraries])
  useEffect(() => { if (selectedLibrary) fetchMovies(selectedLibrary) }, [selectedLibrary, fetchMovies])

  // Available filter options derived from the loaded library. We sort genres
  // by frequency desc so the most-tagged genres bubble to the top of the chip
  // list. MPAA + decades sort alphabetically/chronologically. Resolutions
  // are fixed to the canonical tier order.
  const filterOptions = useMemo(() => {
    const genreCounts = new Map<string, number>()
    const mpaaCounts = new Map<string, number>()
    const decadeCounts = new Map<string, number>()
    const resCounts = new Map<ResolutionTier, number>()

    for (const m of movies) {
      m.Genre?.forEach(g => genreCounts.set(g.tag, (genreCounts.get(g.tag) || 0) + 1))
      if (m.contentRating) mpaaCounts.set(m.contentRating, (mpaaCounts.get(m.contentRating) || 0) + 1)
      const decade = decadeOfYear(m.year)
      if (decade) decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1)
      const tier = getResolutionTier(m.Media?.[0]?.videoResolution)
      resCounts.set(tier, (resCounts.get(tier) || 0) + 1)
    }

    const TIER_ORDER: ResolutionTier[] = ['4K', '1080p', '720p', '480p', 'SD']
    return {
      genres: Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count })),
      mpaa: Array.from(mpaaCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count })),
      decades: Array.from(decadeCounts.entries())
        .sort((a, b) => b[0].localeCompare(a[0])) // newest first
        .map(([tag, count]) => ({ tag, count })),
      resolutions: TIER_ORDER
        .filter(t => (resCounts.get(t) || 0) > 0)
        .map(t => ({ tag: t, count: resCounts.get(t) || 0 })),
    }
  }, [movies])

  // Search → filter → sort pipeline. Each step is cheap relative to typical
  // library size (1-5k items); recomputing on every keystroke is fine.
  const visibleMovies = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const result = movies.filter(m => {
      // Search box (matches title/year/genre/studio)
      if (q) {
        const inTitle = m.title?.toLowerCase().includes(q)
        const inYear = m.year?.toString().includes(q)
        const inGenre = m.Genre?.some(g => g.tag.toLowerCase().includes(q))
        const inStudio = m.studio?.toLowerCase().includes(q)
        if (!inTitle && !inYear && !inGenre && !inStudio) return false
      }
      // Watched filter
      if (filters.watched === 'watched' && !(m.viewCount && m.viewCount > 0)) return false
      if (filters.watched === 'unwatched' && (m.viewCount || 0) > 0) return false
      // Genre — at least one match
      if (filters.genres.length > 0) {
        const tags = (m.Genre || []).map(g => g.tag)
        if (!filters.genres.some(g => tags.includes(g))) return false
      }
      // MPAA
      if (filters.mpaa.length > 0) {
        if (!m.contentRating || !filters.mpaa.includes(m.contentRating)) return false
      }
      // Decade
      if (filters.decades.length > 0) {
        const d = decadeOfYear(m.year)
        if (!d || !filters.decades.includes(d)) return false
      }
      // Resolution
      if (filters.resolutions.length > 0) {
        const tier = getResolutionTier(m.Media?.[0]?.videoResolution)
        if (!filters.resolutions.includes(tier)) return false
      }
      return true
    })
    result.sort(makeComparator(sortKey))
    return result
  }, [movies, searchTerm, filters, sortKey])

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])

  // Toggle a chip in/out of a multi-select filter group.
  const toggleFilter = <K extends 'genres' | 'mpaa' | 'decades' | 'resolutions'>(key: K, value: Filters[K][number]) => {
    setFilters(f => {
      const list = f[key] as Array<typeof value>
      const next = list.includes(value) ? list.filter(v => v !== value) : [...list, value]
      return { ...f, [key]: next } as Filters
    })
  }

  // Aggregate stats for the strip. Computed across the *unfiltered* library so
  // the numbers don't jump as the user types.
  const stats = useMemo(() => {
    if (movies.length === 0) {
      return { count: 0, totalMs: 0, minYear: null as number | null, maxYear: null as number | null,
               resolution: { '4K': 0, '1080p': 0, '720p': 0, '480p': 0, 'SD': 0 } as Record<ResolutionTier, number>,
               topGenre: null as string | null, avgRating: null as number | null }
    }
    let totalMs = 0
    let minYear: number | null = null
    let maxYear: number | null = null
    const resolution: Record<ResolutionTier, number> = { '4K': 0, '1080p': 0, '720p': 0, '480p': 0, 'SD': 0 }
    const genreCount = new Map<string, number>()
    let ratingSum = 0
    let ratingCount = 0

    for (const m of movies) {
      totalMs += m.duration || 0
      if (m.year) {
        if (minYear === null || m.year < minYear) minYear = m.year
        if (maxYear === null || m.year > maxYear) maxYear = m.year
      }
      const tier = getResolutionTier(m.Media?.[0]?.videoResolution)
      resolution[tier]++
      m.Genre?.forEach(g => genreCount.set(g.tag, (genreCount.get(g.tag) || 0) + 1))
      if (typeof m.rating === 'number') {
        ratingSum += m.rating
        ratingCount++
      }
    }

    let topGenre: string | null = null
    let topGenreCount = 0
    for (const [g, c] of genreCount) {
      if (c > topGenreCount) {
        topGenre = g
        topGenreCount = c
      }
    }

    return {
      count: movies.length,
      totalMs,
      minYear,
      maxYear,
      resolution,
      topGenre,
      avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
    }
  }, [movies])

  const pickRandomMovie = () => {
    if (visibleMovies.length === 0) return
    const i = Math.floor(Math.random() * visibleMovies.length)
    setSelectedMovie(visibleMovies[i])
    setShowMobileDetails(true)
  }

  const lastScanLabel = (() => {
    if (!lastScan) return 'never'
    const seconds = Math.floor((Date.now() - lastScan.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  })()

  // Resolution badge — colour-coded by tier.
  const ResBadge = ({ tier }: { tier: ResolutionTier }) => {
    const map: Record<ResolutionTier, { bg: string; fg: string }> = {
      '4K':    { bg: isDark ? 'rgba(123,169,214,0.18)' : 'rgba(74,122,171,0.12)', fg: ACCENT_4K },
      '1080p': { bg: isDark ? 'rgba(143,168,118,0.18)' : 'rgba(107,134,87,0.12)', fg: SAGE },
      '720p':  { bg: isDark ? 'rgba(196,146,74,0.18)'  : 'rgba(140,106,45,0.12)', fg: isDark ? '#E0AC6E' : '#8C6A2D' },
      '480p':  { bg: BORDER, fg: MUTED },
      'SD':    { bg: BORDER, fg: MUTED },
    }
    const { bg, fg } = map[tier]
    return (
      <Box sx={{
        display: 'inline-flex', alignItems: 'center',
        px: 0.7, py: 0.15,
        borderRadius: '4px',
        backgroundColor: bg,
        color: fg,
        fontFamily: MONO,
        fontSize: '0.65rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: 1.4,
      }}>
        {tier}
      </Box>
    )
  }

  // Generic monospace tech badge (codec, audio channels, container, etc.).
  const TechBadge = ({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' }) => (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 0.7, py: 0.15,
      borderRadius: '4px',
      backgroundColor: tone === 'accent' ? RUST_BG : BORDER,
      color: tone === 'accent' ? RUST : MUTED,
      fontFamily: MONO,
      fontSize: '0.65rem',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1.4,
    }}>
      {children}
    </Box>
  )

  // Stats strip mini-card. Stored as a sub-component so the header stays readable.
  const StatCard = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <Card sx={{
      backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS, ...CARD_HOVER_SX,
    }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, mb: 0.4 }}>
          {label}
        </Typography>
        <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.4rem', color: INK, lineHeight: 1.1 }}>
          {value}
        </Typography>
        {sub && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED, mt: 0.3 }}>
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading || loadingLibraries) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: BG }}>
        <Typography sx={{ fontFamily: MONO, color: MUTED, fontSize: '0.9rem' }}>
          {'>'} {loadingLibraries ? 'connecting to plex…' : 'loading library…'}
        </Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, backgroundColor: BG, p: 3 }}>
        <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.4rem', color: INK }}>
          Couldn&apos;t reach Plex
        </Typography>
        <Typography sx={{ fontFamily: MONO, color: MUTED, fontSize: '0.85rem' }}>
          {error}
        </Typography>
        <Button
          onClick={() => selectedLibrary && fetchMovies(selectedLibrary)}
          variant="outlined"
          sx={{
            borderColor: RUST, color: RUST, textTransform: 'none', fontWeight: 600,
            '&:hover': { borderColor: RUST, backgroundColor: RUST_BG },
          }}
        >
          Retry
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ ...pageShellSx(), backgroundColor: 'transparent', color: INK, minHeight: '100vh' }}>

      {/* HEADER */}
      <PageHero
        eyebrow="Plex library"
        title="Your cinema, by the numbers"
        accentPhrase="cinema"
        subtitle={
          <span style={{ fontFamily: MONO, fontSize: '0.85rem' }}>
            {'>'} {(libraries.find(l => l.key === selectedLibrary)?.title || 'library')
              .replace(/\s+/g, '_').toLowerCase()}.scan() &middot; {stats.count.toLocaleString()} title{stats.count === 1 ? '' : 's'} &middot; last_sync: {lastScanLabel}
          </span>
        }
      />

      {/* CONTROLS BAR */}
      <Card sx={{ mb: 3, backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS, ...CARD_HOVER_SX }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5, alignItems: { md: 'center' } }}>
            <FormControl size="small" sx={{ flex: 1, minWidth: 200 }}>
              <Select
                value={selectedLibrary}
                onChange={(e) => setSelectedLibrary(String(e.target.value))}
                disabled={libraries.length === 0}
                displayEmpty
                renderValue={(val) => {
                  const lib = libraries.find(l => l.key === val)
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <VideoLibrary sx={{ fontSize: 16, color: RUST }} />
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>{lib?.title || 'Select library'}</Typography>
                    </Box>
                  )
                }}
                sx={{ backgroundColor: SURFACE, fontSize: '0.88rem' }}
              >
                {libraries.map(lib => (
                  <MenuItem key={lib.key} value={lib.key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <VideoLibrary sx={{ fontSize: 16, color: MUTED }} />
                      <Typography>{lib.title}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size="small"
              placeholder="search title, year, genre, studio…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ flex: 2, minWidth: 220,
                '& .MuiOutlinedInput-root': { backgroundColor: SURFACE, fontSize: '0.88rem' },
                '& input': { fontFamily: MONO, fontSize: '0.85rem' },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ fontSize: 18, color: MUTED }} />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                renderValue={val => {
                  const opt = SORT_OPTIONS.find(o => o.key === val)
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SortIcon sx={{ fontSize: 16, color: RUST }} />
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>{opt?.label || 'Sort'}</Typography>
                    </Box>
                  )
                }}
                sx={{ backgroundColor: SURFACE, fontSize: '0.88rem' }}
              >
                {SORT_OPTIONS.map(opt => (
                  <MenuItem key={opt.key} value={opt.key} sx={{ fontSize: '0.88rem' }}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<FilterIcon sx={{ fontSize: 17 }} />}
              onClick={(e) => setFilterAnchor(e.currentTarget)}
              sx={{
                textTransform: 'none', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
                borderColor: activeFilterCount > 0 ? RUST : BORDER,
                color: activeFilterCount > 0 ? RUST : MUTED,
                backgroundColor: activeFilterCount > 0 ? RUST_BG : 'transparent',
                px: 2,
                '&:hover': { borderColor: RUST, backgroundColor: RUST_BG, color: RUST },
              }}
            >
              Filter
              {activeFilterCount > 0 && (
                <Box component="span" sx={{
                  ml: 0.8, px: 0.7, py: 0.1, borderRadius: '4px',
                  backgroundColor: RUST, color: onAccent(RUST),
                  fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.4,
                }}>
                  {activeFilterCount}
                </Box>
              )}
            </Button>

            <Button
              variant="outlined"
              startIcon={<Shuffle sx={{ fontSize: 17 }} />}
              onClick={pickRandomMovie}
              sx={{
                textTransform: 'none', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
                borderColor: RUST, color: RUST, px: 2,
                '&:hover': { borderColor: RUST, backgroundColor: RUST_BG },
              }}
            >
              Random
            </Button>

            {!readOnly && (
              <Button
                variant="contained"
                startIcon={<PlaylistAddIcon sx={{ fontSize: 17 }} />}
                onClick={() => setPlaylistDialogOpen(true)}
                sx={{
                  textTransform: 'none', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
                  backgroundColor: RUST, color: onAccent(RUST), boxShadow: 'none', px: 2,
                  '&:hover': { backgroundColor: accentHover(RUST, isDark), boxShadow: 'none' },
                }}
              >
                Build Playlist
              </Button>
            )}
          </Box>

          <Typography sx={{ mt: 1.2, fontFamily: MONO, fontSize: '0.7rem', color: MUTED, opacity: 0.7 }}>
            {visibleMovies.length === stats.count
              ? `// showing ${stats.count.toLocaleString()} of ${stats.count.toLocaleString()}`
              : `// filtered: ${visibleMovies.length.toLocaleString()} / ${stats.count.toLocaleString()}`
            }
          </Typography>
        </CardContent>
      </Card>

      {/* ACTIVE FILTERS — visible only when at least one filter is set. Chips
          show what's currently filtering the list, each removable on click. */}
      {activeFilterCount > 0 && (
        <Box sx={{
          mb: 3, p: 1.5,
          backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS,
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6,
        }}>
          <Typography sx={{
            fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase',
            color: MUTED, fontWeight: 700, mr: 1,
          }}>
            // active filters
          </Typography>

          {filters.watched !== 'all' && (
            <Chip
              label={filters.watched}
              size="small"
              onDelete={() => setFilters(f => ({ ...f, watched: 'all' }))}
              sx={{ backgroundColor: RUST_BG, color: RUST, fontWeight: 600, fontSize: '0.72rem',
                    '& .MuiChip-deleteIcon': { color: RUST } }}
            />
          )}
          {filters.genres.map(g => (
            <Chip
              key={`g-${g}`}
              label={g}
              size="small"
              onDelete={() => toggleFilter('genres', g)}
              sx={{ backgroundColor: RUST_BG, color: RUST, fontWeight: 600, fontSize: '0.72rem',
                    '& .MuiChip-deleteIcon': { color: RUST } }}
            />
          ))}
          {filters.mpaa.map(r => (
            <Chip
              key={`m-${r}`}
              label={r}
              size="small"
              onDelete={() => toggleFilter('mpaa', r)}
              sx={{ backgroundColor: RUST_BG, color: RUST, fontWeight: 600, fontSize: '0.72rem',
                    '& .MuiChip-deleteIcon': { color: RUST } }}
            />
          ))}
          {filters.decades.map(d => (
            <Chip
              key={`d-${d}`}
              label={d}
              size="small"
              onDelete={() => toggleFilter('decades', d)}
              sx={{ backgroundColor: RUST_BG, color: RUST, fontWeight: 600, fontSize: '0.72rem',
                    '& .MuiChip-deleteIcon': { color: RUST } }}
            />
          ))}
          {filters.resolutions.map(r => (
            <Chip
              key={`r-${r}`}
              label={r}
              size="small"
              onDelete={() => toggleFilter('resolutions', r)}
              sx={{ backgroundColor: RUST_BG, color: RUST, fontWeight: 600, fontSize: '0.72rem',
                    '& .MuiChip-deleteIcon': { color: RUST } }}
            />
          ))}

          <Button
            size="small"
            onClick={() => setFilters(EMPTY_FILTERS)}
            sx={{
              ml: 'auto', textTransform: 'none', color: MUTED,
              fontFamily: MONO, fontSize: '0.72rem',
              '&:hover': { color: RUST, backgroundColor: 'transparent' },
            }}
          >
            clear all
          </Button>
        </Box>
      )}

      {/* STATS STRIP */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
        gap: 1.5, mb: 3,
      }}>
        <StatCard
          label="titles"
          value={stats.count.toLocaleString()}
          sub={stats.avgRating !== null ? `avg ⭐ ${stats.avgRating.toFixed(1)}` : null}
        />
        <StatCard
          label="total runtime"
          value={formatTotalRuntime(stats.totalMs)}
          sub={`${Math.round(stats.totalMs / 60000).toLocaleString()} min`}
        />
        <StatCard
          label="year span"
          value={stats.minYear && stats.maxYear ? `${stats.minYear}–${stats.maxYear}` : '—'}
          sub={stats.minYear && stats.maxYear ? `${stats.maxYear - stats.minYear} yrs` : null}
        />
        <StatCard
          label="4K titles"
          value={stats.resolution['4K']}
          sub={stats.count > 0 ? `${Math.round((stats.resolution['4K'] / stats.count) * 100)}% of library` : null}
        />
        <StatCard
          label="1080p titles"
          value={stats.resolution['1080p']}
          sub={stats.count > 0 ? `${Math.round((stats.resolution['1080p'] / stats.count) * 100)}% of library` : null}
        />
        <StatCard
          label="top genre"
          value={stats.topGenre || '—'}
          sub={stats.topGenre ? 'most-tagged' : null}
        />
      </Box>

      {/* LIST + DETAIL */}
      <Box sx={{
        display: 'flex',
        gap: { xs: 1, md: 2 },
        flexDirection: { xs: 'column', md: 'row' },
        height: { xs: 'calc(100vh - 100px)', md: 'calc(100vh - 360px)' },
        minHeight: 500,
      }}>

        {/* LEFT — list */}
        <Card sx={{
          width: { xs: '100%', md: 380 },
          flexShrink: 0,
          display: { xs: showMobileDetails ? 'none' : 'flex', md: 'flex' },
          flexDirection: 'column',
          backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS, ...CARD_HOVER_SX,
        }}>
          <Box sx={{
            px: 2, py: 1.2, borderBottom: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            <MovieIcon sx={{ fontSize: 16, color: RUST }} />
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: MUTED, letterSpacing: '0.06em' }}>
              {visibleMovies.length.toLocaleString()} title{visibleMovies.length === 1 ? '' : 's'}
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}>
            <Stack spacing={0.75}>
              {visibleMovies.length === 0 ? (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: MUTED, p: 2, fontStyle: 'italic' }}>
                  no titles match the current filter
                </Typography>
              ) : (
                visibleMovies.map(movie => {
                  const selected = selectedMovie?.ratingKey === movie.ratingKey
                  const media = movie.Media?.[0]
                  const tier = getResolutionTier(media?.videoResolution)
                  const codec = media?.videoCodec ? normaliseCodec(media.videoCodec) : null
                  const audio = audioChannelLabel(media?.audioChannels)
                  return (
                    <Box
                      key={movie.ratingKey}
                      onClick={() => { setSelectedMovie(movie); setShowMobileDetails(true) }}
                      sx={{
                        cursor: 'pointer',
                        p: 1.2,
                        borderRadius: '8px',
                        border: `1px solid ${selected ? RUST : 'transparent'}`,
                        borderTop: `2px solid ${selected ? RUST : BORDER}`,
                        backgroundColor: selected ? RUST_BG : 'transparent',
                        '&:hover': { backgroundColor: selected ? RUST_BG : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') },
                        transition: 'background-color 0.12s, border-color 0.12s',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.4 }}>
                        <Typography sx={{
                          flex: 1, fontWeight: 600, fontSize: '0.88rem', color: INK,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {movie.title}
                        </Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: MUTED, flexShrink: 0 }}>
                          {movie.year}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, alignItems: 'center' }}>
                        <ResBadge tier={tier} />
                        {codec && <TechBadge>{codec}</TechBadge>}
                        {audio && <TechBadge>{audio}</TechBadge>}
                        {typeof movie.rating === 'number' && (
                          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, ml: 'auto' }}>
                            ⭐ {movie.rating.toFixed(1)}
                          </Typography>
                        )}
                      </Box>
                      {movie.Genre && movie.Genre.length > 0 && (
                        <Typography sx={{
                          fontSize: '0.72rem', color: MUTED, mt: 0.4,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {movie.Genre.slice(0, 3).map(g => g.tag).join(' · ')}
                        </Typography>
                      )}
                    </Box>
                  )
                })
              )}
            </Stack>
          </Box>
        </Card>

        {/* RIGHT — detail */}
        <Card sx={{
          flexGrow: 1,
          display: { xs: showMobileDetails ? 'flex' : 'none', md: 'flex' },
          flexDirection: 'column',
          backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS, ...CARD_HOVER_SX,
          overflow: 'hidden',
        }}>
          {selectedMovie ? (
            <Box sx={{ overflow: 'auto', flex: 1 }}>
              {/* Mobile back button */}
              <Box sx={{ display: { xs: 'block', md: 'none' }, p: 1, borderBottom: `1px solid ${BORDER}` }}>
                <Button
                  onClick={() => { setShowMobileDetails(false) }}
                  startIcon={<ArrowLeft sx={{ fontSize: 17 }} />}
                  sx={{
                    width: '100%', textTransform: 'none', color: MUTED,
                    '&:hover': { backgroundColor: 'transparent', color: RUST },
                  }}
                >
                  Back to library
                </Button>
              </Box>

              {/* Backdrop banner with overlaid title */}
              <Box sx={{
                position: 'relative',
                height: { xs: 200, md: 280 },
                backgroundColor: SURFACE,
                backgroundImage: selectedArtUrl ? `url("${selectedArtUrl}")` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}>
                <Box sx={{
                  position: 'absolute', inset: 0,
                  background: `linear-gradient(to bottom, transparent 0%, ${PAPER}E6 80%, ${PAPER} 100%)`,
                }} />
                <Box sx={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  px: { xs: 2, md: 3 }, pb: 2,
                }}>
                  <Typography sx={{
                    fontFamily: SERIF, fontWeight: 700, color: INK,
                    fontSize: { xs: '1.6rem', md: '2.2rem' }, lineHeight: 1.1, letterSpacing: '-0.02em',
                    textShadow: isDark ? '0 2px 12px rgba(0,0,0,0.7)' : '0 1px 2px rgba(255,255,255,0.6)',
                  }}>
                    {selectedMovie.title}
                  </Typography>
                  {selectedMovie.tagline && (
                    <Typography sx={{
                      fontStyle: 'italic', color: MUTED, fontSize: '0.92rem', mt: 0.5,
                    }}>
                      {selectedMovie.tagline}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Box sx={{ p: { xs: 2, md: 3 } }}>

                {/* Top-line metadata row */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3, alignItems: 'center' }}>
                  <Tooltip title="Year">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <CalendarIcon sx={{ fontSize: 14, color: MUTED }} />
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', color: INK }}>
                        {selectedMovie.year}
                      </Typography>
                    </Box>
                  </Tooltip>
                  <Tooltip title="Runtime">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <TimeIcon sx={{ fontSize: 14, color: MUTED }} />
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', color: INK }}>
                        {formatDuration(selectedMovie.duration)}
                      </Typography>
                    </Box>
                  </Tooltip>
                  {selectedMovie.contentRating && (
                    <Tooltip title="MPAA rating">
                      <Box sx={{
                        px: 0.7, py: 0.1, border: `1px solid ${BORDER}`, borderRadius: '4px',
                        fontFamily: MONO, fontSize: '0.7rem', color: MUTED, fontWeight: 600,
                      }}>
                        {selectedMovie.contentRating}
                      </Box>
                    </Tooltip>
                  )}
                  {typeof selectedMovie.rating === 'number' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <StarIcon sx={{ fontSize: 14, color: '#E0AC6E' }} />
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', color: INK }}>
                        {selectedMovie.rating.toFixed(1)}
                      </Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED }}>/ 10</Typography>
                    </Box>
                  )}
                  {typeof selectedMovie.audienceRating === 'number' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '0.95rem' }}>🍅</Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', color: INK }}>
                        {Math.round(selectedMovie.audienceRating * 10)}%
                      </Typography>
                    </Box>
                  )}
                  {selectedMovie.viewCount && selectedMovie.viewCount > 0 && (
                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, letterSpacing: '0.05em' }}>
                        watched {selectedMovie.viewCount}×
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* TECH SPECS — the geeky panel */}
                {selectedMovie.Media && selectedMovie.Media.length > 0 && (
                  <Box sx={{
                    mb: 3, p: 2,
                    border: `1px solid ${BORDER}`, borderRadius: '8px',
                    backgroundColor: SURFACE,
                  }}>
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.15em',
                      textTransform: 'uppercase', color: RUST, fontWeight: 700, mb: 1.2,
                    }}>
                      // tech specs
                    </Typography>
                    <Box sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
                      gap: 1.2,
                    }}>
                      {selectedMovie.Media.map((m, idx) => {
                        const tier = getResolutionTier(m.videoResolution)
                        const dims = m.width && m.height ? `${m.width}×${m.height}` : null
                        const aspect = m.aspectRatio ? m.aspectRatio.toFixed(2) + ':1' : null
                        const fps = m.videoFrameRate?.replace(/[^\d.]/g, '') || null
                        const audio = audioChannelLabel(m.audioChannels)
                        const bitrate = formatBitrate(m.bitrate)

                        return (
                          <Box key={m.id || idx} sx={{ gridColumn: { xs: 'span 2', sm: 'span 3', md: 'span 4' }, display: 'grid', gridTemplateColumns: 'inherit', gap: 'inherit' }}>
                            <SpecRow label="resolution" mono={MONO} muted={MUTED} ink={INK}>
                              <ResBadge tier={tier} />
                              {dims && <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK, ml: 0.6 }}>{dims}</Typography>}
                            </SpecRow>
                            <SpecRow label="video" mono={MONO} muted={MUTED} ink={INK}>
                              <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK }}>
                                {normaliseCodec(m.videoCodec)}{fps ? ` · ${fps} fps` : ''}
                              </Typography>
                            </SpecRow>
                            <SpecRow label="audio" mono={MONO} muted={MUTED} ink={INK}>
                              <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK }}>
                                {(m.audioCodec || '—').toUpperCase()}{audio ? ` · ${audio}` : ''}
                              </Typography>
                            </SpecRow>
                            <SpecRow label="container" mono={MONO} muted={MUTED} ink={INK}>
                              <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK }}>
                                {(m.container || '—').toUpperCase()}
                              </Typography>
                            </SpecRow>
                            {bitrate && (
                              <SpecRow label="bitrate" mono={MONO} muted={MUTED} ink={INK}>
                                <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK }}>
                                  {bitrate}
                                </Typography>
                              </SpecRow>
                            )}
                            {aspect && (
                              <SpecRow label="aspect" mono={MONO} muted={MUTED} ink={INK}>
                                <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.78rem', color: INK }}>
                                  {aspect}
                                </Typography>
                              </SpecRow>
                            )}
                          </Box>
                        )
                      })}
                    </Box>
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.65rem', color: MUTED, mt: 1.2, opacity: 0.7,
                      borderTop: `1px solid ${BORDER}`, pt: 0.8,
                    }}>
                      ratingKey: {selectedMovie.ratingKey} · added {new Date(selectedMovie.addedAt * 1000).toISOString().slice(0, 10)}
                    </Typography>
                  </Box>
                )}

                {/* Summary */}
                {selectedMovie.summary && (
                  <Box sx={{ mb: 3 }}>
                    <SectionHeading mono={MONO} rust={RUST}>summary</SectionHeading>
                    <Typography sx={{ fontSize: '0.92rem', color: INK, lineHeight: 1.7 }}>
                      {selectedMovie.summary}
                    </Typography>
                  </Box>
                )}

                {/* Genres */}
                {selectedMovie.Genre && selectedMovie.Genre.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <SectionHeading mono={MONO} rust={RUST}>genres</SectionHeading>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                      {selectedMovie.Genre.map((g, i) => (
                        <Chip
                          key={i}
                          label={g.tag}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            backgroundColor: RUST_BG,
                            color: RUST,
                            border: `1px solid ${BORDER}`,
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Crew/Cast grid */}
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                  gap: 2.5, mb: 3,
                }}>
                  {selectedMovie.Director && selectedMovie.Director.length > 0 && (
                    <Box>
                      <SectionHeading mono={MONO} rust={RUST}>{selectedMovie.Director.length === 1 ? 'director' : 'directors'}</SectionHeading>
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>
                        {selectedMovie.Director.map(d => d.tag).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {selectedMovie.Writer && selectedMovie.Writer.length > 0 && (
                    <Box>
                      <SectionHeading mono={MONO} rust={RUST}>{selectedMovie.Writer.length === 1 ? 'writer' : 'writers'}</SectionHeading>
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>
                        {selectedMovie.Writer.map(w => w.tag).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {selectedMovie.studio && (
                    <Box>
                      <SectionHeading mono={MONO} rust={RUST}>studio</SectionHeading>
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>
                        {selectedMovie.studio}
                      </Typography>
                    </Box>
                  )}
                  {selectedMovie.Country && selectedMovie.Country.length > 0 && (
                    <Box>
                      <SectionHeading mono={MONO} rust={RUST}>country</SectionHeading>
                      <Typography sx={{ fontSize: '0.88rem', color: INK }}>
                        {selectedMovie.Country.map(c => c.tag).join(', ')}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {selectedMovie.Role && selectedMovie.Role.length > 0 && (
                  <Box>
                    <SectionHeading mono={MONO} rust={RUST}>cast</SectionHeading>
                    <Typography sx={{ fontSize: '0.88rem', color: INK, lineHeight: 1.7 }}>
                      {selectedMovie.Role.slice(0, 12).map(r => r.tag).join(' · ')}
                      {selectedMovie.Role.length > 12 && (
                        <Typography component="span" sx={{ color: MUTED, fontFamily: MONO, fontSize: '0.78rem', ml: 0.5 }}>
                          + {selectedMovie.Role.length - 12} more
                        </Typography>
                      )}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          ) : (
            <Box sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              flex: 1, textAlign: 'center', p: 4,
            }}>
              <VideoLibrary sx={{ fontSize: 56, color: MUTED, opacity: 0.5, mb: 1.5 }} />
              <Typography sx={{ fontFamily: SERIF, fontSize: '1.1rem', color: INK, mb: 0.5 }}>
                Pick a title or hit Random
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: MUTED }}>
                {'>'} awaiting selection…
              </Typography>
            </Box>
          )}
        </Card>
      </Box>

      {/* FILTER POPOVER — anchored to the Filter button in the controls bar.
          Each group is a multi-select chip array (except Watched, a 3-way
          toggle). Counts on chips show how many titles match each value
          across the *unfiltered* library so users see what's available. */}
      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, p: 2.5, width: { xs: '92vw', sm: 480 }, maxHeight: '70vh',
              backgroundColor: PAPER, border: `1px solid ${BORDER}`, borderRadius: CARD_RADIUS,
              boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.5)' : '0 12px 32px rgba(60,35,15,0.18)',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{
            fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase',
            color: RUST, fontWeight: 700,
          }}>
            // filters
          </Typography>
          <Button
            size="small"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={activeFilterCount === 0}
            sx={{
              ml: 'auto', textTransform: 'none', color: MUTED,
              fontFamily: MONO, fontSize: '0.72rem',
              '&:hover': { color: RUST, backgroundColor: 'transparent' },
            }}
          >
            reset
          </Button>
        </Box>

        {/* Watched */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{
            fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            color: MUTED, fontWeight: 600, mb: 0.8,
          }}>
            watched
          </Typography>
          <ToggleButtonGroup
            value={filters.watched}
            exclusive
            size="small"
            onChange={(_, v) => v && setFilters(f => ({ ...f, watched: v as WatchedFilter }))}
            sx={{
              '& .MuiToggleButton-root': {
                // Unselected uses INK rather than MUTED: at this size MUTED reads
                // as disabled rather than merely unselected.
                px: 2, py: 0.5, textTransform: 'none', fontSize: '0.78rem',
                color: INK, borderColor: BORDER,
                '&.Mui-selected': { backgroundColor: RUST_BG, color: RUST, borderColor: RUST, fontWeight: 600 },
                '&.Mui-selected:hover': { backgroundColor: RUST_BG },
              },
            }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="watched">Watched</ToggleButton>
            <ToggleButton value="unwatched">Unwatched</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Divider sx={{ borderColor: BORDER, mb: 2 }} />

        {/* Resolution */}
        {filterOptions.resolutions.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: MUTED, fontWeight: 600, mb: 0.8,
            }}>
              resolution
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
              {filterOptions.resolutions.map(({ tag, count }) => {
                const selected = filters.resolutions.includes(tag)
                return (
                  <Chip
                    key={tag}
                    label={`${tag} · ${count}`}
                    size="small"
                    onClick={() => toggleFilter('resolutions', tag)}
                    sx={{
                      fontFamily: MONO, fontSize: '0.72rem', fontWeight: 600,
                      backgroundColor: selected ? RUST_BG : 'transparent',
                      color: selected ? RUST : INK,
                      border: `1px solid ${selected ? RUST : BORDER}`,
                      '&:hover': { backgroundColor: RUST_BG, borderColor: RUST },
                    }}
                  />
                )
              })}
            </Box>
          </Box>
        )}

        {/* MPAA */}
        {filterOptions.mpaa.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: MUTED, fontWeight: 600, mb: 0.8,
            }}>
              MPAA rating
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
              {filterOptions.mpaa.map(({ tag, count }) => {
                const selected = filters.mpaa.includes(tag)
                return (
                  <Chip
                    key={tag}
                    label={`${tag} · ${count}`}
                    size="small"
                    onClick={() => toggleFilter('mpaa', tag)}
                    sx={{
                      fontFamily: MONO, fontSize: '0.72rem', fontWeight: 600,
                      backgroundColor: selected ? RUST_BG : 'transparent',
                      color: selected ? RUST : INK,
                      border: `1px solid ${selected ? RUST : BORDER}`,
                      '&:hover': { backgroundColor: RUST_BG, borderColor: RUST },
                    }}
                  />
                )
              })}
            </Box>
          </Box>
        )}

        {/* Decade */}
        {filterOptions.decades.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: MUTED, fontWeight: 600, mb: 0.8,
            }}>
              decade
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
              {filterOptions.decades.map(({ tag, count }) => {
                const selected = filters.decades.includes(tag)
                return (
                  <Chip
                    key={tag}
                    label={`${tag} · ${count}`}
                    size="small"
                    onClick={() => toggleFilter('decades', tag)}
                    sx={{
                      fontFamily: MONO, fontSize: '0.72rem', fontWeight: 600,
                      backgroundColor: selected ? RUST_BG : 'transparent',
                      color: selected ? RUST : INK,
                      border: `1px solid ${selected ? RUST : BORDER}`,
                      '&:hover': { backgroundColor: RUST_BG, borderColor: RUST },
                    }}
                  />
                )
              })}
            </Box>
          </Box>
        )}

        {/* Genre — last because it's typically the longest. Renders in a
            scrollable region so the popover height stays reasonable. */}
        {filterOptions.genres.length > 0 && (
          <Box>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: MUTED, fontWeight: 600, mb: 0.8,
            }}>
              genre
            </Typography>
            <Box sx={{
              display: 'flex', flexWrap: 'wrap', gap: 0.6,
              maxHeight: 180, overflowY: 'auto', pr: 0.5,
            }}>
              {filterOptions.genres.map(({ tag, count }) => {
                const selected = filters.genres.includes(tag)
                return (
                  <Chip
                    key={tag}
                    label={`${tag} · ${count}`}
                    size="small"
                    onClick={() => toggleFilter('genres', tag)}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 600,
                      backgroundColor: selected ? RUST_BG : 'transparent',
                      color: selected ? RUST : INK,
                      border: `1px solid ${selected ? RUST : BORDER}`,
                      '&:hover': { backgroundColor: RUST_BG, borderColor: RUST },
                    }}
                  />
                )
              })}
            </Box>
          </Box>
        )}
      </Popover>

      <PlaylistBuilderDialog
        open={playlistDialogOpen}
        onClose={() => setPlaylistDialogOpen(false)}
      />
    </Box>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeading({ children, mono, rust }: { children: React.ReactNode; mono: string; rust: string }) {
  return (
    <Typography sx={{
      fontFamily: mono, fontSize: '0.65rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', color: rust, fontWeight: 700, mb: 0.8,
    }}>
      // {children}
    </Typography>
  )
}

function SpecRow({ label, children, mono, muted, ink }: {
  label: string; children: React.ReactNode; mono: string; muted: string; ink: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
      <Typography sx={{
        fontFamily: mono, fontSize: '0.62rem', letterSpacing: '0.08em',
        textTransform: 'uppercase', color: muted, fontWeight: 600, flexShrink: 0, minWidth: 70,
      }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexWrap: 'wrap', color: ink }}>
        {children}
      </Box>
    </Box>
  )
}
