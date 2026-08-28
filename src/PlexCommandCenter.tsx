import { apiClient } from './services/apiClient'
import { AuthenticatedImage } from './services/authenticatedImage'
import { CARD_RADIUS, PAGE_GUTTER, pageShellSx } from './theme/controls'
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useThemeMode } from './context/ThemeContext'
import { tokensFor } from './theme/tokens'
import { withAlpha } from './theme/contrast'

const PlexUsers = lazy(() => import('./components/PlexUsers'))
const DuplicatesTab = lazy(() => import('./components/duplicates/DuplicatesTab'))
import { Box, Typography, Chip, CircularProgress, IconButton, Tooltip, LinearProgress, Button, TextField, InputAdornment, ToggleButton, ToggleButtonGroup, Select, MenuItem, FormControl, Dialog } from '@mui/material'
import {
  Refresh as RefreshIcon,
  Movie as MovieIcon,
  Tv as TvIcon,
  MusicNote as MusicIcon,
  FiberManualRecord as DotIcon,
  Person as PersonIcon,
  Warning as WarningIcon,
  Photo as PhotoIcon,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  AutoAwesome as SparkleIcon,
  Search as SearchIcon,
  ContentCopy as CopyIcon,
  AccessTime as ClockIcon,
  NotificationsNone as NotifIcon,
  PlayArrow as PlayIcon,
  PlaylistPlay as PlaylistIcon,
  AutoFixHigh as SmartIcon,
  Close as CloseIcon,
} from './components/AppIcons'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

// ── Theme-aware palette ───────────────────────────────────────────────────
// Neutrals and the accent come from the tokens in force, so the palette,
// accent and text colour pinned to this page in the theme flyout reach it.
// This was a hard-coded Wine Cellar ramp, which is why changing the theme
// moved the sidebar but left the whole page — and the Duplicates tab, which
// receives these as its DupPalette — sitting on the old colours.
//
// green/red/blue/amber/purple stay fixed: they carry stream and library state,
// and a status that changes meaning with the theme is worse than one that
// clashes with it.
function useC() {
  const { mode, palette } = useThemeMode()
  const d = mode === 'dark'
  const t = tokensFor(d, palette)
  const border = t.line
  const accent = d ? t.rustLight : t.rustDark
  return {
    bg:     t.bg,
    surface:t.surface,
    paper:  t.paper,
    border,
    ink:    t.ink,
    muted:  t.muted,
    rust:   accent,
    rustBg: withAlpha(accent, d ? 0.18 : 0.10),
    green:  d ? '#7CAE6A' : '#4F7A3E',
    red:    d ? '#D47A6A' : '#B05945',
    blue:   d ? '#7AA8C4' : '#4A7A9B',
    amber:  d ? '#DCB87A' : '#9A7A20',
    purple: d ? '#9E86C8' : '#6B5A9A',
    // Journal-page card style — mirrors the MuiCard defaults in ThemeContext.
    // Spread into a Box's sx to lift it from flat to gradient + paper-fold
    // top highlight. Hovering adds a warmth glow in the page's own accent.
    cardSx: {
      background: `linear-gradient(180deg, ${t.paper} 0%, ${t.surface} 100%)`,
      border: `1px solid ${border}`,
      boxShadow: d
        ? `inset 0 1px 0 ${withAlpha(t.champagne, 0.10)}`
        : 'inset 0 1px 0 rgba(255,255,255,0.85)',
      transition: 'box-shadow 0.22s, border-color 0.18s, transform 0.18s',
    } as const,
    cardHoverSx: {
      boxShadow: d
        ? `inset 0 1px 0 ${withAlpha(t.champagne, 0.14)}, 0 18px 36px -16px ${withAlpha(accent, 0.42)}, 0 6px 14px -6px rgba(0,0,0,0.45)`
        : `inset 0 1px 0 rgba(255,255,255,0.95), 0 16px 32px -16px ${withAlpha(accent, 0.28)}, 0 6px 14px -6px ${withAlpha(t.ink, 0.10)}`,
    } as const,
  }
}

function useSeriesColors() {
  const { mode, palette } = useThemeMode()
  const d = mode === 'dark'
  const t = tokensFor(d, palette)
  // Chart series — first slot follows the page accent so a themed page does not
  // keep a plum line; the rest are categorical colors that stay distinct for
  // multi-series readability.
  return [
    d ? t.rustLight : t.rustDark,
    d ? '#DCB87A' : '#9A7A20',
    d ? '#7AA8C4' : '#4A7A9B',
    d ? '#9E86C8' : '#6B5A9A',
    d ? '#7CAE6A' : '#4F7A3E',
  ]
}

type Tab = 'overview' | 'graphs' | 'history' | 'users' | 'logs' | 'duplicates'

// Log-related types
type LogSource = 'all' | 'tautulli' | 'plex' | 'notifications'
type LogLevel  = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'FAILURE' | string

// Normalised log row — union of Tautulli log, Plex log, and notification entry.
interface LogRow {
  id:        string        // generated client-side
  source:    'tautulli' | 'plex' | 'notifications'
  timestamp: string        // ISO-8601 or formatted string from Tautulli
  level:     LogLevel
  // For tautulli / plex logs
  thread?:   string
  message:   string
  // For notification log only
  notifier?:       string  // agent_name
  action?:         string  // notify_action
  subject?:        string  // subject_text
  detail?:         string  // body_text
  user?:           string
  success?:        boolean
}

type LogTimeRange = '1h' | '6h' | '24h' | '7d' | 'all'

// ── Types ─────────────────────────────────────────────────────────────────
interface Session {
  session_key: string
  user: string
  friendly_name: string
  title: string
  parent_title: string
  grandparent_title: string
  media_type: 'movie' | 'episode' | 'track'
  year: number
  progress_percent: string
  transcode_decision: string
  stream_video_codec: string
  stream_video_full_resolution: string
  stream_audio_codec: string
  stream_audio_channels: number
  bandwidth: string
  player: string
  platform: string
  thumb: string
}

interface Activity {
  stream_count: number
  stream_count_direct_play: number
  stream_count_direct_stream: number
  stream_count_transcode: number
  total_bandwidth: number
  lan_bandwidth: number
  wan_bandwidth: number
  sessions: Session[]
}

interface Library {
  section_id: number
  section_name: string
  section_type: 'movie' | 'show' | 'artist' | 'photo'
  count: number
  parent_count: number | null
  child_count: number | null
  plays: number
  duration: number
  last_accessed: number
  last_played: string | null
  is_active: number
}

interface StatRow {
  user?: string
  friendly_name?: string
  title?: string
  grandparent_title?: string
  total_plays: number
  total_duration: number
}

interface HomeStat {
  stat_id: string
  rows: StatRow[]
}

interface SeriesData {
  categories: string[]
  series: { name: string; data: number[] }[]
}

interface HistoryRow {
  id: number
  date: number
  user: string
  friendly_name: string
  ip_address: string
  platform: string
  product: string
  player: string
  full_title: string
  title: string
  parent_title: string
  grandparent_title: string
  media_type: 'movie' | 'episode' | 'track'
  media_index: number | string
  parent_media_index: number | string
  year: number
  started: number
  stopped: number
  paused_counter: number
  duration: number
  transcode_decision: string
  percent_complete: number
  thumb?: string
}

interface WatchStat {
  query_days: number
  total_plays: number
  total_duration: number
}

interface LibUserStat {
  user_id: number
  user: string
  friendly_name: string
  user_thumb: string
  total_plays: number
  total_duration: number
}

interface RecentItem {
  rating_key: string
  title: string
  year: number
  thumb: string
  added_at: number
  media_type: string
}

interface CoolFactsData {
  topMovies:  Array<{ title?: string; grandparent_title?: string; total_plays: number; total_duration: number; rating_key?: string }>
  topTV:      Array<{ grandparent_title?: string; title?: string; total_plays: number; total_duration: number }>
  topUsers:   Array<{ user: string; friendly_name?: string; total_plays: number; total_duration: number }>
  lastWatched: Array<{ title?: string; grandparent_title?: string; friendly_name?: string; user?: string; media_type?: string }>
  userMediaBreakdown: Record<string, { moviePlays: number; tvPlays: number }>
  topGenres:  string[]
  peakDay:    { date: string; plays: number } | null
}

interface MediaInfoRow {
  rating_key: string
  title: string
  year: number
  added_at: number
  container: string
  bitrate: number
  video_codec: string
  video_resolution: string
  video_framerate: string
  audio_codec: string
  audio_channels: number
  file_size: number
  last_played: number | null
  play_count: number
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtDurationLong(seconds: number): string {
  if (!seconds) return '0m'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeAgo(unixSec: number): string {
  if (!unixSec) return 'never'
  const s = Math.floor(Date.now() / 1000) - unixSec
  if (s < 60)       return 'just now'
  if (s < 3600)     return `${Math.floor(s / 60)}m ago`
  if (s < 86400)    return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000)  return `${Math.floor(s / 86400)}d ago`
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`
  return `${Math.floor(s / 31536000)}y ago`
}

function fmtUnixDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString('en-CA')
}

function fmtUnixTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function transformSeries(data: SeriesData | null, isDate = false): Record<string, string | number>[] {
  if (!data?.categories?.length) return []
  return data.categories.map((cat, i) => {
    const obj: Record<string, string | number> = { name: isDate ? fmtDate(cat) : cat }
    data.series.forEach(s => { obj[s.name] = s.data[i] ?? 0 })
    return obj
  })
}

function activeSeriesKeys(data: SeriesData | null): string[] {
  if (!data) return []
  return data.series.filter(s => s.data.some(v => v > 0)).map(s => s.name)
}

function transcodeColor(d: string, C: ReturnType<typeof useC>) {
  if (d === 'direct play') return C.green
  if (d === 'copy')        return C.blue
  return C.rust
}
function transcodeLabel(d: string) {
  if (d === 'direct play') return 'Direct'
  if (d === 'copy')        return 'Stream'
  return 'Transcode'
}

function libraryIcon(type: string) {
  if (type === 'show')   return <TvIcon    sx={{ fontSize: 18 }} />
  if (type === 'artist') return <MusicIcon sx={{ fontSize: 18 }} />
  if (type === 'photo')  return <PhotoIcon sx={{ fontSize: 18 }} />
  return <MovieIcon sx={{ fontSize: 18 }} />
}

function historyTitle(row: HistoryRow): string {
  if (row.media_type === 'episode') {
    const s = row.parent_media_index ? `S${row.parent_media_index}` : ''
    const e = row.media_index ? `E${row.media_index}` : ''
    const ep = [s, e].filter(Boolean).join('·')
    return `${row.full_title}${ep ? ` (${ep})` : ''}`
  }
  return row.year ? `${row.full_title} (${row.year})` : row.full_title
}

// ── Sub-components ────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  const C = useC()
  return (
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>
      {label}
    </Typography>
  )
}

function SectionHeader({ label }: { label: string }) {
  return <Box sx={{ mb: 1.5 }}><SectionLabel label={label} /></Box>
}

function Empty({ label }: { label: string }) {
  const C = useC()
  return (
    <Box sx={{ py: 3, textAlign: 'center' }}>
      <Typography sx={{ color: C.muted, fontSize: '0.82rem', fontStyle: 'italic' }}>{label}</Typography>
    </Box>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  const C = useC()
  const accent = color ?? C.rust
  return (
    <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2 }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: '0.72rem', color: C.muted, mt: 0.25 }}>{sub}</Typography>}
    </Box>
  )
}

function SessionCard({ s }: { s: Session }) {
  const C   = useC()
  const isEpisode = s.media_type === 'episode'
  const title    = isEpisode ? `${s.grandparent_title} — ${s.title}` : s.title
  const subtitle = isEpisode ? s.parent_title : String(s.year || '')
  const progress = parseInt(s.progress_percent, 10) || 0
  const bitrate  = s.bandwidth ? `${(parseInt(s.bandwidth) / 1000).toFixed(1)} Mbps` : null
  const codec    = [s.stream_video_codec?.toUpperCase(), s.stream_video_full_resolution].filter(Boolean).join(' · ')
  const audio    = [s.stream_audio_codec?.toUpperCase(), s.stream_audio_channels ? `${s.stream_audio_channels}ch` : null].filter(Boolean).join(' · ')
  const thumb    = s.thumb ? `/api/tautulli/image?img=${encodeURIComponent(s.thumb)}&width=80&height=120` : null
  const tColor   = transcodeColor(s.transcode_decision, C)

  return (
    <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2, display: 'flex', gap: 2 }}>
      <Box sx={{ width: 56, height: 84, borderRadius: '6px', flexShrink: 0, overflow: 'hidden', bgcolor: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumb
          ? <AuthenticatedImage source={thumb} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <MovieIcon sx={{ color: C.muted, fontSize: 24 }} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.5 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem', color: C.ink }}>{title}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>{subtitle}</Typography>
          </Box>
          <Chip label={transcodeLabel(s.transcode_decision)} size="small" sx={{
            ml: 1, height: 20, fontSize: '0.65rem', fontWeight: 700,
            bgcolor: `${tColor}20`,
            color: tColor,
            border: `1px solid ${tColor}44`,
          }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
          <PersonIcon sx={{ fontSize: 13, color: C.muted }} />
          <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>
            {s.friendly_name || s.user} · {s.player || s.platform}
          </Typography>
        </Box>
        <Box sx={{ mb: 1 }}>
          <LinearProgress variant="determinate" value={progress} sx={{
            height: 3, borderRadius: 99, bgcolor: C.surface,
            '& .MuiLinearProgress-bar': { bgcolor: C.rust, borderRadius: 99 },
          }} />
          <Typography sx={{ fontSize: '0.65rem', color: C.muted, mt: 0.25 }}>{progress}%</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {[codec, audio, bitrate].filter(Boolean).map(tag => (
            <Box key={tag} sx={{ px: 0.75, py: 0.125, borderRadius: '4px', bgcolor: C.surface, border: `1px solid ${C.border}` }}>
              <Typography sx={{ fontSize: '0.62rem', color: C.muted }}>{tag}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ── Chart sub-components ──────────────────────────────────────────────────
function SeriesBarChart({ data, keys }: { data: Record<string, string | number>[]; keys: string[] }) {
  const C = useC()
  const SERIES_COLORS = useSeriesColors()
  const tooltipStyle = {
    contentStyle: { backgroundColor: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, color: C.ink },
    labelStyle: { color: C.ink, fontWeight: 600 },
    itemStyle: { color: C.ink },
  }
  const axisProps = { tick: { fill: C.muted, fontSize: 11 }, axisLine: false, tickLine: false }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <ChartTooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: '0.75rem', color: C.muted }} />
        {keys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="a" fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={i === keys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function ChartCard({ label, children }: { label: string; children: React.ReactNode }) {
  const C = useC()
  return (
    <Box>
      <SectionHeader label={label} />
      <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2 }}>
        {children}
      </Box>
    </Box>
  )
}

function DaysToggle({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  const C = useC()
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {([7, 30, 90] as const).map(d => (
        <Box key={d} onClick={() => onChange(d)} sx={{
          px: 1.5, py: 0.4, borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
          fontWeight: value === d ? 700 : 400,
          bgcolor:   value === d ? C.rustBg : C.paper,
          color:     value === d ? C.rust : C.muted,
          border:    `1px solid ${value === d ? C.rust + '66' : C.border}`,
          '&:hover': { borderColor: `${C.rust}55` },
        }}>
          {d}D
        </Box>
      ))}
    </Box>
  )
}

// ── Cool Facts helpers ────────────────────────────────────────────────────
function funnyTimeComparison(hours: number): string {
  if (hours <= 0) return 'The screen is still lonely 🙁'
  const days = hours / 24
  if (days >= 365) return `${Math.round(days / 365)} full years of non-stop content 😱`
  if (days >= 30)  return `${Math.floor(days)} days straight — actual dedication 🤯`
  if (hours >= 480) return `Breaking Bad ${Math.round(hours / 48)}× start to finish 🧪`
  if (hours >= 200) return `the entire MCU ${(hours / 49).toFixed(0)}× over 🦸`
  if (hours >= 90)  return `all 10 seasons of Friends ${(hours / 90).toFixed(1)}× 🛋️`
  if (hours >= 40)  return `LOTR extended editions ${Math.round(hours / 11.5)}× 💍`
  if (hours >= 14)  return `all Star Wars films ${Math.round(hours / 14)}× 🚀`
  return `${Math.round(hours * 2)} homemade pizzas worth of time 🍕`
}

// ── Cool Facts section ────────────────────────────────────────────────────
function CoolFactsSection({
  coolFacts, libraries, loading,
}: {
  coolFacts: CoolFactsData | null
  libraries: Library[] | null
  loading: boolean
}) {
  const C            = useC()
  const SERIES_COLORS = useSeriesColors()

  const movieLibs    = (libraries ?? []).filter(l => l.section_type === 'movie' && l.is_active)
  const tvLibs       = (libraries ?? []).filter(l => l.section_type === 'show'  && l.is_active)
  // Use "All Movies" if it exists — avoids double-counting sub-libraries inside it
  const primaryMovieLib   = movieLibs.find(l => l.section_name === 'All Movies') ?? null
  const movieLibsForStats = primaryMovieLib ? [primaryMovieLib] : movieLibs
  const movieHours   = movieLibsForStats.reduce((s, l) => s + (l.duration ?? 0), 0) / 3600
  const tvHours      = tvLibs.reduce((s, l) => s + (l.duration ?? 0), 0) / 3600
  const movieItems   = movieLibsForStats.reduce((s, l) => s + (l.count ?? 0), 0)
  const tvEpisodes   = tvLibs.reduce((s, l) => s + ((l.child_count ?? l.count) ?? 0), 0)

  const topUsers     = coolFacts?.topUsers    ?? []
  const topMovies    = coolFacts?.topMovies   ?? []
  const topTV        = coolFacts?.topTV       ?? []
  const topGenres    = coolFacts?.topGenres   ?? []
  const peakDay      = coolFacts?.peakDay     ?? null
  const breakdown    = coolFacts?.userMediaBreakdown ?? {}
  const maxPlays     = topUsers[0]?.total_plays ?? 1

  const skeleton = (h: number) => (
    <Box sx={{ height: h, bgcolor: C.surface, borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite', '@keyframes pulse': { '0%,100%': { opacity: 0.6 }, '50%': { opacity: 1 } } }} />
  )

  return (
    <Box sx={{ mb: 3 }}>
      <SectionHeader label="Cool Facts · All Time" />

      {/* ── Movie + TV stat cards ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        {/* Movies */}
        <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <MovieIcon sx={{ fontSize: 20, color: C.rust }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: C.ink }}>Movies</Typography>
          </Box>
          <Typography sx={{ fontSize: '2.4rem', fontWeight: 800, color: C.rust, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {movieHours > 999 ? `${(movieHours / 1000).toFixed(1)}K` : Math.round(movieHours).toLocaleString()}
            <Box component="span" sx={{ fontSize: '1rem', fontWeight: 400, color: C.muted, ml: 0.5 }}>hrs</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: C.muted, mb: 1.5 }}>
            watched across {movieItems.toLocaleString()} movies in library
          </Typography>
          {topMovies[0] ? (
            <Box sx={{ mb: 1.5, p: 1.25, bgcolor: C.surface, borderRadius: '8px' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25 }}>Most Watched</Typography>
              <Typography noWrap sx={{ fontSize: '0.85rem', color: C.ink, fontWeight: 600 }}>{topMovies[0].title}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: C.rust }}>{topMovies[0].total_plays} plays this month</Typography>
            </Box>
          ) : loading ? skeleton(64) : null}
          <Typography sx={{ fontSize: '0.72rem', color: C.amber, fontStyle: 'italic' }}>
            {funnyTimeComparison(movieHours)}
          </Typography>
        </Box>

        {/* TV Shows */}
        <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <TvIcon sx={{ fontSize: 20, color: C.blue }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: C.ink }}>TV Shows</Typography>
          </Box>
          <Typography sx={{ fontSize: '2.4rem', fontWeight: 800, color: C.blue, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {tvHours > 999 ? `${(tvHours / 1000).toFixed(1)}K` : Math.round(tvHours).toLocaleString()}
            <Box component="span" sx={{ fontSize: '1rem', fontWeight: 400, color: C.muted, ml: 0.5 }}>hrs</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: C.muted, mb: 1.5 }}>
            {tvEpisodes > 0 ? `across ${tvEpisodes.toLocaleString()} episodes in library` : 'of TV episodes watched'}
          </Typography>
          {topTV[0] ? (
            <Box sx={{ mb: 1.5, p: 1.25, bgcolor: C.surface, borderRadius: '8px' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25 }}>Most Watched Series</Typography>
              <Typography noWrap sx={{ fontSize: '0.85rem', color: C.ink, fontWeight: 600 }}>{topTV[0].grandparent_title || topTV[0].title}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: C.blue }}>{topTV[0].total_plays} plays this month</Typography>
            </Box>
          ) : loading ? skeleton(64) : null}
          <Typography sx={{ fontSize: '0.72rem', color: C.amber, fontStyle: 'italic' }}>
            {funnyTimeComparison(tvHours)}
          </Typography>
        </Box>
      </Box>

      {/* ── Top Viewers leaderboard ── */}
      <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2.5, mb: 2 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, mb: 2 }}>
          Top Viewers
        </Typography>
        {loading && !topUsers.length ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Box key={i} sx={{ height: 40, bgcolor: C.surface, borderRadius: '8px', animation: 'pulse 1.5s ease-in-out infinite', '@keyframes pulse': { '0%,100%': { opacity: 0.6 }, '50%': { opacity: 1 } } }} />
            ))}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
            {topUsers.map((u, i) => {
              const bd        = breakdown[u.user]
              const bdTotal   = (bd?.moviePlays ?? 0) + (bd?.tvPlays ?? 0)
              const moviePct  = bdTotal > 0 ? Math.round((bd!.moviePlays / bdTotal) * 100) : null
              const tvPct     = moviePct != null ? 100 - moviePct : null
              const hours     = Math.round((u.total_duration ?? 0) / 3600)
              const barWidth  = Math.round((u.total_plays / maxPlays) * 100)
              const color     = SERIES_COLORS[i % SERIES_COLORS.length]

              return (
                <Box key={u.user}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                    {/* Avatar */}
                    <Box sx={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      bgcolor: `${color}22`, color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: i === 0 ? '0.85rem' : '0.72rem', fontWeight: 700,
                    }}>
                      {i === 0 ? '👑' : (u.friendly_name || u.user || '?')[0].toUpperCase()}
                    </Box>

                    {/* Name + stats */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.4 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: C.ink }}>
                          {u.friendly_name || u.user}
                        </Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: C.muted }}>
                          {u.total_plays.toLocaleString()} plays · {hours}h
                        </Typography>
                      </Box>
                      {/* Play bar */}
                      <Box sx={{ height: 5, bgcolor: C.surface, borderRadius: '3px', overflow: 'hidden' }}>
                        <Box sx={{ width: `${barWidth}%`, height: '100%', bgcolor: color, borderRadius: '3px' }} />
                      </Box>
                    </Box>

                    {/* Movie vs TV breakdown */}
                    {moviePct != null && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                        <Tooltip title={`Movies: ${bd!.moviePlays} plays`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <MovieIcon sx={{ fontSize: 11, color: C.rust }} />
                            <Typography sx={{ fontSize: '0.65rem', color: C.muted }}>{moviePct}%</Typography>
                          </Box>
                        </Tooltip>
                        <Box sx={{ width: 1, height: 12, bgcolor: C.border }} />
                        <Tooltip title={`TV: ${bd!.tvPlays} plays`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <TvIcon sx={{ fontSize: 11, color: C.blue }} />
                            <Typography sx={{ fontSize: '0.65rem', color: C.muted }}>{tvPct}%</Typography>
                          </Box>
                        </Tooltip>
                      </Box>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>

      {/* ── Fun stat chips row ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 1.5 }}>
        {topGenres.length > 0 && (
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75 }}>Top Genres</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {topGenres.slice(0, 4).map((g, i) => (
                <Chip key={g} label={g} size="small" sx={{
                  height: 20, fontSize: '0.68rem',
                  bgcolor: `${SERIES_COLORS[i % SERIES_COLORS.length]}18`,
                  color:   SERIES_COLORS[i % SERIES_COLORS.length],
                  border:  `1px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}44`,
                }} />
              ))}
            </Box>
          </Box>
        )}

        {peakDay && peakDay.plays > 0 && (
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>Peak Binge Day</Typography>
            <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: C.green, lineHeight: 1 }}>{peakDay.plays}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: C.muted }}>
              plays on {new Date(peakDay.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Typography>
          </Box>
        )}

        {topMovies[0] && (
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>🏆 Top Movie Ever</Typography>
            <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.ink }}>{topMovies[0].title}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: C.rust }}>{topMovies[0].total_plays.toLocaleString()} plays all time</Typography>
          </Box>
        )}

        {topTV[0] && (
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>🏆 Top Show Ever</Typography>
            <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.ink }}>{topTV[0].grandparent_title || topTV[0].title}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: C.blue }}>{topTV[0].total_plays.toLocaleString()} plays all time</Typography>
          </Box>
        )}

        {topUsers[0] && (
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>👑 Binge King</Typography>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: C.ink }}>{topUsers[0].friendly_name || topUsers[0].user}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: C.muted }}>
              {topUsers[0].total_plays} plays · {Math.round((topUsers[0].total_duration ?? 0) / 3600)}h watched
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function PlexCommandCenter() {
  const C            = useC()
  const SERIES_COLORS = useSeriesColors()

  const [activeTab,    setActiveTab]    = useState<Tab>('overview')
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null)
  const [configured,   setConfigured]   = useState<boolean | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null)

  // Overview
  const [activity,   setActivity]   = useState<Activity | null>(null)
  const [libraries,  setLibraries]  = useState<Library[] | null>(null)
  const [homeStats,  setHomeStats]  = useState<HomeStat[] | null>(null)

  // Graphs
  const [graphDays,    setGraphDays]    = useState(30)
  const [playsData,    setPlaysData]    = useState<SeriesData | null>(null)
  const [dowData,      setDowData]      = useState<SeriesData | null>(null)
  const [hodData,      setHodData]      = useState<SeriesData | null>(null)
  const [platformData, setPlatformData] = useState<SeriesData | null>(null)
  const graphsLoaded = useRef(false)

  // History
  const [historyRows,    setHistoryRows]    = useState<HistoryRow[]>([])
  const [historyTotal,   setHistoryTotal]   = useState(0)
  const [historyPage,    setHistoryPage]    = useState(1)
  const [historyLength]                     = useState(25)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyLoaded = useRef(false)

  const [insights,        setInsights]        = useState<string[] | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsTs,      setInsightsTs]      = useState<Date | null>(null)
  const [coolFacts,       setCoolFacts]       = useState<CoolFactsData | null>(null)
  const [coolFactsLoading, setCoolFactsLoading] = useState(false)

  const fetchActivity = useCallback(async () => {
    try {
      const r = await apiClient.fetch('/api/tautulli/activity')
      const d = await r.json()
      if (!r.ok) { setError(d.error); return }
      setActivity(d)
      setLastRefresh(new Date())
      setError(null)
    } catch { setError('Failed to reach Tautulli') }
  }, [])

  const fetchOverview = useCallback(async () => {
    const [statsR, libsR, hodR, dowR] = await Promise.all([
      apiClient.fetch('/api/tautulli/home-stats?days=30'),
      apiClient.fetch('/api/tautulli/libraries'),
      apiClient.fetch('/api/tautulli/plays-by-hourofday?days=30'),
      apiClient.fetch('/api/tautulli/plays-by-dayofweek?days=30'),
    ])
    if (statsR.ok) setHomeStats(await statsR.json())
    if (libsR.ok)  setLibraries(await libsR.json())
    if (hodR.ok)   setHodData(await hodR.json())
    if (dowR.ok)   setDowData(await dowR.json())
  }, [])

  const fetchGraphs = useCallback(async (days: number) => {
    const [playsR, dowR, hodR, platR] = await Promise.all([
      apiClient.fetch(`/api/tautulli/plays-by-date?days=${days}`),
      apiClient.fetch(`/api/tautulli/plays-by-dayofweek?days=${days}`),
      apiClient.fetch(`/api/tautulli/plays-by-hourofday?days=${days}`),
      apiClient.fetch(`/api/tautulli/plays-by-platform?days=${days}`),
    ])
    if (playsR.ok) setPlaysData(await playsR.json())
    if (dowR.ok)   setDowData(await dowR.json())
    if (hodR.ok)   setHodData(await hodR.json())
    if (platR.ok)  setPlatformData(await platR.json())
  }, [])

  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    try {
      const r = await apiClient.fetch(`/api/tautulli/history?page=${page}&length=${historyLength}`)
      if (r.ok) {
        const d = await r.json()
        setHistoryRows(d.data)
        setHistoryTotal(d.total)
      }
    } finally { setHistoryLoading(false) }
  }, [historyLength])

  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true)
    try {
      const r = await apiClient.fetch('/api/tautulli/ai-insights')
      const d = await r.json()
      if (r.ok) { setInsights(d.insights); setInsightsTs(new Date()) }
    } finally { setInsightsLoading(false) }
  }, [])

  const fetchCoolFacts = useCallback(async () => {
    setCoolFactsLoading(true)
    try {
      const r = await apiClient.fetch('/api/tautulli/cool-facts')
      if (r.ok) setCoolFacts(await r.json())
    } finally { setCoolFactsLoading(false) }
  }, [])

  // Initial load
  useEffect(() => {
    ;(async () => {
      try {
        const r = await apiClient.fetch('/api/tautulli/status')
        const d = await r.json()
        setConfigured(d.configured)
        if (!d.configured) return
        await Promise.all([fetchActivity(), fetchOverview()])
        fetchCoolFacts() // fire-and-forget — loads behind the fold
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    })()
    const interval = setInterval(fetchActivity, 60_000)
    return () => clearInterval(interval)
  }, [fetchActivity, fetchOverview, fetchCoolFacts])

  // Load graphs lazily on first tab open
  useEffect(() => {
    if (activeTab === 'graphs' && configured && !graphsLoaded.current) {
      graphsLoaded.current = true
      fetchGraphs(graphDays)
    }
  }, [activeTab, configured, graphDays, fetchGraphs])

  // Reload graphs when days changes
  useEffect(() => {
    if (graphsLoaded.current && configured) fetchGraphs(graphDays)
  }, [graphDays, configured, fetchGraphs])

  // Load history lazily
  useEffect(() => {
    if (activeTab === 'history' && configured && !historyLoaded.current) {
      historyLoaded.current = true
      fetchHistory(1)
    }
  }, [activeTab, configured, fetchHistory])

  // Reload history on page change
  useEffect(() => {
    if (historyLoaded.current) fetchHistory(historyPage)
  }, [historyPage, fetchHistory])

  // ── Logs tab state ───────────────────────────────────────────────────────
  const [logSource,      setLogSource]      = useState<LogSource>('all')
  const [logSearch,      setLogSearch]      = useState('')
  const [logLevels,      setLogLevels]      = useState<LogLevel[]>([])
  const [logTimeRange,   setLogTimeRange]   = useState<LogTimeRange>('24h')
  const [logSortDir,     setLogSortDir]     = useState<'desc' | 'asc'>('desc')
  const [logAutoRefresh, setLogAutoRefresh] = useState(false)

  const [tautulliLogs,    setTautulliLogs]    = useState<LogRow[]>([])
  const [plexLogs,        setPlexLogs]        = useState<LogRow[]>([])
  const [notifLogs,       setNotifLogs]       = useState<LogRow[]>([])

  const [tautulliLoading, setTautulliLoading] = useState(false)
  const [plexLoading,     setPlexLoading]     = useState(false)
  const [notifLoading,    setNotifLoading]    = useState(false)

  const [tautulliError,   setTautulliError]   = useState<string | null>(null)
  const [plexError,       setPlexError]       = useState<string | null>(null)
  const [notifError,      setNotifError]      = useState<string | null>(null)

  const logsLoaded = useRef(false)
  const autoRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Parse a Tautulli timestamp string to a Date for time-range filtering.
  // Tautulli returns timestamps as "YYYY-MM-DD HH:MM:SS" or unix seconds.
  const parseLogTs = (ts: string | number): Date => {
    if (typeof ts === 'number') return new Date(ts * 1000)
    // Try ISO-like "YYYY-MM-DD HH:MM:SS"
    const iso = ts.replace(' ', 'T')
    const d = new Date(iso)
    return isNaN(d.getTime()) ? new Date(0) : d
  }

  const normaliseLevel = (raw: string): LogLevel => {
    const v = (raw || '').toUpperCase()
    if (v === 'WARN') return 'WARNING'
    if (v === 'CRITICAL') return 'ERROR'
    return v as LogLevel
  }

  const fetchTautulliLogs = useCallback(async () => {
    setTautulliLoading(true)
    setTautulliError(null)
    try {
      const r = await apiClient.fetch(`/api/tautulli/logs/tautulli?rows=1000&order=${logSortDir}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      // Tautulli's get_logs returns objects: { time, loglevel, msg, thread }
      const rows: LogRow[] = (d.entries || []).map((e: any, i: number) => ({
        id:        `tau-${i}`,
        source:    'tautulli' as const,
        timestamp: (e.time || e.timestamp || '').trim(),
        level:     normaliseLevel(e.loglevel || 'INFO'),
        thread:    (e.thread || '').trim(),
        message:   (e.msg || e.message || '').trim(),
      }))
      setTautulliLogs(rows)
    } catch (e: any) {
      setTautulliError(e.message)
    } finally {
      setTautulliLoading(false)
    }
  }, [logSortDir])

  const fetchPlexLogs = useCallback(async () => {
    setPlexLoading(true)
    setPlexError(null)
    try {
      const r = await apiClient.fetch(`/api/tautulli/logs/plex?rows=1000&order=${logSortDir}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      // Tautulli's get_plex_log returns arrays: [timestamp, level, message]
      // (no thread/PID — Tautulli strips that from the raw Plex log line).
      // Fall back to object-style in case Tautulli changes its format.
      const rows: LogRow[] = (d.entries || []).map((e: any, i: number) => {
        const isTuple = Array.isArray(e)
        return {
          id:        `plex-${i}`,
          source:    'plex' as const,
          timestamp: isTuple ? String(e[0] || '').trim() : (e.timestamp || e.time || '').trim(),
          level:     normaliseLevel(isTuple ? String(e[1] || 'INFO') : (e.loglevel || 'INFO')),
          thread:    isTuple ? '' : (e.thread || '').trim(),
          message:   isTuple ? String(e[2] || '').replace(/\r?\n$/, '') : (e.msg || e.message || '').trim(),
        }
      })
      setPlexLogs(rows)
    } catch (e: any) {
      setPlexError(e.message)
    } finally {
      setPlexLoading(false)
    }
  }, [logSortDir])

  const fetchNotifLogs = useCallback(async () => {
    setNotifLoading(true)
    setNotifError(null)
    try {
      const r = await apiClient.fetch(`/api/tautulli/logs/notifications?rows=1000&order=${logSortDir}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      const rows: LogRow[] = (d.entries || []).map((e: any, i: number) => ({
        id:        `notif-${i}`,
        source:    'notifications' as const,
        timestamp: typeof e.timestamp === 'number'
                     ? new Date(e.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)
                     : (e.timestamp || ''),
        level:     e.success === 1 || e.success === true ? 'SUCCESS' : 'FAILURE',
        message:   e.subject_text || e.notify_action || '',
        notifier:  e.agent_name || '',
        action:    e.notify_action || '',
        subject:   e.subject_text || '',
        detail:    e.body_text || '',
        user:      e.user || '',
        success:   e.success === 1 || e.success === true,
      }))
      setNotifLogs(rows)
    } catch (e: any) {
      setNotifError(e.message)
    } finally {
      setNotifLoading(false)
    }
  }, [logSortDir])

  const fetchAllLogs = useCallback(() => {
    fetchTautulliLogs()
    fetchPlexLogs()
    fetchNotifLogs()
  }, [fetchTautulliLogs, fetchPlexLogs, fetchNotifLogs])

  // Load logs lazily when the tab is first opened.
  useEffect(() => {
    if (activeTab === 'logs' && configured && !logsLoaded.current) {
      logsLoaded.current = true
      fetchAllLogs()
    }
  }, [activeTab, configured, fetchAllLogs])

  // Auto-refresh every 30 s when the toggle is on.
  useEffect(() => {
    if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current)
    if (logAutoRefresh && activeTab === 'logs') {
      autoRefreshTimer.current = setInterval(fetchAllLogs, 30_000)
    }
    return () => { if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current) }
  }, [logAutoRefresh, activeTab, fetchAllLogs])

  // Time-range cutoff in ms from epoch.
  const logCutoffMs = (() => {
    if (logTimeRange === 'all') return 0
    const now = Date.now()
    const h = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[logTimeRange] || 24
    return now - h * 3_600_000
  })()

  // Combined, filtered, sorted rows for the current view.
  const visibleLogs = (() => {
    const pools: LogRow[][] = []
    if (logSource === 'all' || logSource === 'tautulli')   pools.push(tautulliLogs)
    if (logSource === 'all' || logSource === 'plex')        pools.push(plexLogs)
    if (logSource === 'all' || logSource === 'notifications') pools.push(notifLogs)
    let rows = pools.flat()

    // Time range
    if (logCutoffMs > 0) {
      rows = rows.filter(r => {
        const ts = parseLogTs(r.timestamp)
        return ts.getTime() >= logCutoffMs
      })
    }
    // Level filter
    if (logLevels.length > 0) {
      rows = rows.filter(r => logLevels.includes(r.level))
    }
    // Full-text search
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase()
      rows = rows.filter(r =>
        r.message.toLowerCase().includes(q) ||
        r.thread?.toLowerCase().includes(q) ||
        r.notifier?.toLowerCase().includes(q) ||
        r.subject?.toLowerCase().includes(q) ||
        r.detail?.toLowerCase().includes(q) ||
        r.user?.toLowerCase().includes(q) ||
        r.action?.toLowerCase().includes(q),
      )
    }
    // Sort
    rows.sort((a, b) => {
      const ta = parseLogTs(a.timestamp).getTime()
      const tb = parseLogTs(b.timestamp).getTime()
      return logSortDir === 'desc' ? tb - ta : ta - tb
    })
    return rows
  })()

  const logsLoading = tautulliLoading || plexLoading || notifLoading

  const topUsers  = homeStats?.find(s => s.stat_id === 'top_users')?.rows  ?? []
  const topMovies = homeStats?.find(s => s.stat_id === 'top_movies')?.rows ?? []
  const topTV     = homeStats?.find(s => s.stat_id === 'top_tv')?.rows     ?? []
  const maxUserDuration = topUsers[0]?.total_duration ?? 1

  // Viewing-patterns card computations
  const hodByHour = Array.from({ length: 24 }, (_, i) =>
    (hodData?.series ?? []).reduce((sum, s) => sum + (s.data[i] ?? 0), 0)
  )
  const hodMax        = Math.max(...hodByHour, 1)
  const peakHourIdx   = hodByHour.indexOf(Math.max(...hodByHour))
  const fmtHourLabel  = (h: number) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
  const DOW_LABELS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dowByDay      = Array.from({ length: 7 }, (_, i) =>
    (dowData?.series ?? []).reduce((sum, s) => sum + (s.data[i] ?? 0), 0)
  )
  const dowMax           = Math.max(...dowByDay, 1)
  const peakDayIdx       = dowByDay.indexOf(Math.max(...dowByDay))
  const totalMonthlyPlays = hodByHour.reduce((a, b) => a + b, 0)

  const tooltipStyle = {
    contentStyle: { backgroundColor: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, color: C.ink },
    labelStyle: { color: C.ink, fontWeight: 600 },
    itemStyle: { color: C.ink },
  }
  const axisProps = { tick: { fill: C.muted, fontSize: 11 }, axisLine: false, tickLine: false }

  if (loading) return (
    <Box sx={{ bgcolor: 'transparent', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress sx={{ color: C.rust }} />
    </Box>
  )

  if (configured === false) return (
    <Box sx={{ bgcolor: 'transparent', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
      <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
        <WarningIcon sx={{ fontSize: 40, color: C.rust, mb: 2 }} />
        <Typography sx={{ color: C.ink, fontWeight: 700, fontSize: '1.1rem', mb: 1 }}>Tautulli not configured</Typography>
        <Typography sx={{ color: C.muted, fontSize: '0.875rem' }}>
          Add <code style={{ color: C.rust }}>TAUTULLI_API_KEY</code> (and optionally{' '}
          <code style={{ color: C.rust }}>TAUTULLI_URL</code>) to your <code style={{ color: C.blue }}>.env</code> file and restart the server.
        </Typography>
      </Box>
    </Box>
  )

  const totalPages = Math.ceil(historyTotal / historyLength)

  return (
    <Box sx={{ ...pageShellSx(true), bgcolor: 'transparent', minHeight: '100%', color: C.ink }}>

      {/* ── Sticky header ──
          Floats like the sidebar rather than sitting flush in the corner: it
          sticks at the shared page gutter, so its top edge lands on the same
          line as the sidebar's, and carries the card radius + shadow so it
          reads as one more surface hovering over the wallpaper. It used to be
          a square, full-bleed band welded to the top of the viewport. */}
      <Box sx={{
        position: 'sticky', top: `${PAGE_GUTTER}px`, zIndex: 50,
        bgcolor: C.surface, border: `1px solid ${C.border}`,
        borderRadius: CARD_RADIUS,
        boxShadow: 'var(--card-shadow)',
        px: { xs: 2, md: 3 }, pt: 2, pb: 0,
        mb: 2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '1.1rem', color: C.ink, letterSpacing: '-0.01em' }}>
              Plex Command Center
            </Typography>
            {lastRefresh && (
              <Typography sx={{ fontSize: '0.7rem', color: C.muted }}>
                Live · refreshed {lastRefresh.toLocaleTimeString()}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {activity && (
              <Chip
                icon={<DotIcon sx={{ fontSize: '10px !important', color: `${C.green} !important` }} />}
                label={`${activity.stream_count} stream${activity.stream_count !== 1 ? 's' : ''}`}
                size="small"
                sx={{ bgcolor: `${C.green}18`, color: C.green, border: `1px solid ${C.green}33`, fontSize: '0.78rem' }}
              />
            )}
            <Tooltip title="Refresh activity">
              <IconButton onClick={fetchActivity} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Tab bar */}
        <Box sx={{ display: 'flex', gap: 0 }}>
          {(['overview', 'graphs', 'history', 'users', 'logs', 'duplicates'] as Tab[]).map(tab => (
            <Box
              key={tab}
              onClick={() => setActiveTab(tab)}
              sx={{
                px: 2, py: 1, cursor: 'pointer', fontSize: '0.82rem', fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? C.rust : C.muted,
                borderBottom: activeTab === tab ? `2px solid ${C.rust}` : '2px solid transparent',
                textTransform: 'capitalize',
                '&:hover': { color: activeTab === tab ? C.rust : C.ink },
                transition: 'color 0.15s',
              }}
            >
              {tab}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Horizontal padding comes from the page shell now; only the vertical
          rhythm belongs to this block. */}
      <Box sx={{ py: { xs: 2, md: 3 } }}>

        {error && (
          <Box sx={{ bgcolor: `${C.red}15`, border: `1px solid ${C.red}33`, borderRadius: '8px', p: 1.5, mb: 2 }}>
            <Typography sx={{ color: C.red, fontSize: '0.82rem' }}>{error}</Typography>
          </Box>
        )}

        {/* ── Bandwidth stats row (always visible) ── */}
        {activity && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 3 }}>
            <StatCard label="Active Streams"  value={activity.stream_count}                color={C.rust} />
            <StatCard label="Direct Play"     value={activity.stream_count_direct_play}    color={C.green} />
            <StatCard label="Transcoding"     value={activity.stream_count_transcode}      color={C.amber} />
            <StatCard label="Total Bandwidth" value={`${Math.round((activity.total_bandwidth || 0) / 1000)} Mbps`} color={C.blue}
              sub={`LAN ${Math.round((activity.lan_bandwidth||0)/1000)} · WAN ${Math.round((activity.wan_bandwidth||0)/1000)}`} />
          </Box>
        )}

        {/* ══════════════════ OVERVIEW TAB ══════════════════ */}
        {activeTab === 'overview' && (
          <Box>
            {selectedLibrary ? (
              <LibraryDetailView library={selectedLibrary} onBack={() => setSelectedLibrary(null)} />
            ) : (<>
            {/* Live Sessions */}
            <SectionHeader label="Live Activity" />
            {!activity?.sessions?.length ? (
              <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, mb: 3 }}>
                <Empty label="No active streams" />
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' }, gap: 1.5, mb: 3 }}>
                {activity.sessions.map(s => <SessionCard key={s.session_key} s={s} />)}
              </Box>
            )}

            {/* ── Cool Facts ── */}
            <CoolFactsSection coolFacts={coolFacts} libraries={libraries} loading={coolFactsLoading} />

            {/* ── AI Cards: Viewing Patterns + Plex Intelligence ── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 2, mb: 3 }}>

              {/* Viewing Patterns — heatmap + day bars */}
              <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
                  <Box>
                    <SectionLabel label="Viewing Patterns" />
                    {totalMonthlyPlays > 0 && (
                      <Typography sx={{ fontSize: '0.75rem', color: C.muted, mt: 0.5 }}>
                        Peak&nbsp;
                        <Box component="span" sx={{ color: C.rust, fontWeight: 700 }}>{fmtHourLabel(peakHourIdx)}</Box>
                        &nbsp;·&nbsp;Busiest&nbsp;
                        <Box component="span" sx={{ color: C.rust, fontWeight: 700 }}>{DOW_LABELS[peakDayIdx]}</Box>
                        &nbsp;·&nbsp;{totalMonthlyPlays.toLocaleString()} plays
                      </Typography>
                    )}
                  </Box>
                  <Chip label="30 days" size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: C.surface, color: C.muted, border: `1px solid ${C.border}` }} />
                </Box>

                {/* Hour-of-day heatmap */}
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.09em', mb: 0.75 }}>
                  Activity by Hour
                </Typography>
                {hodData ? (
                  <Box>
                    <Box sx={{ display: 'flex', gap: '2px', mb: 0.5 }}>
                      {hodByHour.map((count, h) => {
                        const pct = count === 0 ? 0 : Math.max(0.12, count / hodMax)
                        const op  = Math.round(pct * 255).toString(16).padStart(2, '0')
                        return (
                          <Tooltip key={h} title={`${fmtHourLabel(h)}: ${count} plays`} placement="top">
                            <Box sx={{
                              flex: 1, height: 28, borderRadius: '3px', cursor: 'default',
                              bgcolor: count === 0 ? C.surface : `${C.rust}${op}`,
                              outline: h === peakHourIdx ? `2px solid ${C.rust}` : 'none',
                              outlineOffset: '1px',
                            }} />
                          </Tooltip>
                        )
                      })}
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                      {[0, 6, 12, 18, 23].map(h => (
                        <Typography key={h} sx={{ fontSize: '0.58rem', color: C.muted }}>{fmtHourLabel(h)}</Typography>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ height: 36, bgcolor: C.surface, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress size={14} sx={{ color: C.muted }} />
                  </Box>
                )}

                {/* Day-of-week bar chart */}
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.09em', mt: 2.5, mb: 0.75 }}>
                  Activity by Day
                </Typography>
                <Box sx={{ display: 'flex', gap: '6px', alignItems: 'flex-end', height: 64 }}>
                  {dowByDay.map((count, d) => {
                    const isPeak = d === peakDayIdx
                    return (
                      <Tooltip key={d} title={`${DOW_LABELS[d]}: ${count} plays`}>
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, height: '100%' }}>
                          <Box sx={{
                            width: '100%',
                            height: `${Math.max(4, Math.round((count / dowMax) * 48))}px`,
                            borderRadius: '3px 3px 1px 1px',
                            bgcolor: isPeak ? C.rust : `${C.rust}55`,
                          }} />
                          <Typography sx={{ fontSize: '0.6rem', lineHeight: 1, color: isPeak ? C.rust : C.muted, fontWeight: isPeak ? 700 : 400 }}>
                            {DOW_LABELS[d].slice(0, 2)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    )
                  })}
                </Box>
              </Box>

              {/* Plex Intelligence — Claude Haiku insights */}
              <Box sx={{ bgcolor: C.paper, border: `1px solid ${C.purple}44`, borderRadius: CARD_RADIUS, p: 2.5, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <SparkleIcon sx={{ fontSize: 18, color: C.purple }} />
                  <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: C.ink, flex: 1 }}>Plex Intelligence</Typography>
                  <Chip label="Claude Haiku" size="small" sx={{
                    height: 18, fontSize: '0.62rem',
                    bgcolor: `${C.purple}18`, color: C.purple, border: `1px solid ${C.purple}44`,
                  }} />
                </Box>

                <Box sx={{ flex: 1, mb: 1.5, minHeight: 110 }}>
                  {insightsLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
                      <CircularProgress size={16} thickness={4} sx={{ color: C.purple }} />
                      <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>Analyzing your viewing data…</Typography>
                    </Box>
                  ) : insights ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                      {insights.map((insight, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, mt: '6px', bgcolor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                          <Typography sx={{ fontSize: '0.82rem', color: C.ink, lineHeight: 1.55 }}>{insight}</Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography sx={{ fontSize: '0.82rem', color: C.muted, fontStyle: 'italic', lineHeight: 1.6, pt: 0.5 }}>
                      Claude will analyze your viewing habits, top users, peak hours, and content trends to surface personalized insights.
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1.5, borderTop: `1px solid ${C.border}` }}>
                  <Button
                    size="small"
                    onClick={fetchInsights}
                    disabled={insightsLoading}
                    startIcon={insights ? <RefreshIcon sx={{ fontSize: 14 }} /> : <SparkleIcon sx={{ fontSize: 14 }} />}
                    sx={{
                      textTransform: 'none', fontSize: '0.78rem', fontWeight: 600,
                      color: C.purple, border: `1px solid ${C.purple}44`, borderRadius: CARD_RADIUS,
                      px: 1.5, py: 0.5, minWidth: 0,
                      '&:hover': { bgcolor: `${C.purple}15`, borderColor: C.purple },
                      '&:disabled': { color: C.muted, borderColor: C.border },
                    }}
                  >
                    {insights ? 'Regenerate' : 'Generate Insights'}
                  </Button>
                  {insightsTs && (
                    <Typography sx={{ fontSize: '0.68rem', color: C.muted }}>
                      {insightsTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>

            {/* Libraries Table */}
            <SectionHeader label="Libraries" />
            <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden', mb: 3 }}>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 90px 90px 100px 1fr 60px 80px',
                px: 2, py: 1,
                borderBottom: `1px solid ${C.border}`,
                bgcolor: C.surface,
              }}>
                {['Library', 'Type', 'Items', 'Seasons', 'Last Streamed', 'Last Played', 'Plays', 'Duration'].map(h => (
                  <Typography key={h} sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {h}
                  </Typography>
                ))}
              </Box>
              {(libraries ?? []).filter(l => l.is_active).map((lib, i) => (
                <Box key={lib.section_id} onClick={() => setSelectedLibrary(lib)} sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 60px 90px 90px 100px 1fr 60px 80px',
                  px: 2, py: 1.25, alignItems: 'center', cursor: 'pointer',
                  borderBottom: i < (libraries?.length ?? 0) - 1 ? `1px solid ${C.border}` : 'none',
                  '&:hover': { bgcolor: `${C.surface}aa` },
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Box sx={{ color: C.rust, flexShrink: 0, display: 'flex' }}>{libraryIcon(lib.section_type)}</Box>
                    <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.ink }}>{lib.section_name}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: C.muted, textTransform: 'capitalize' }}>{lib.section_type === 'show' ? 'TV' : lib.section_type}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: C.ink }}>{(lib.count ?? 0).toLocaleString()}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>
                    {lib.parent_count != null ? lib.parent_count.toLocaleString() : '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>{timeAgo(lib.last_accessed)}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: C.muted }}>{lib.last_played || '—'}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: C.rust }}>{(lib.plays ?? 0).toLocaleString()}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>{fmtDuration(lib.duration ?? 0)}</Typography>
                </Box>
              ))}
              {!libraries?.length && <Empty label="No library data" />}
            </Box>

            {/* Top Users + Top Content */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, mb: 3 }}>
              {/* Top Users */}
              <Box>
                <SectionHeader label="Top Users — Last 30 Days" />
                <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
                  {topUsers.length === 0 && <Box sx={{ p: 2 }}><Empty label="No user data" /></Box>}
                  {topUsers.map((u, i) => (
                    <Box key={u.friendly_name || u.user} sx={{ px: 2, py: 1.5, borderBottom: i < topUsers.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.7rem', color: C.muted, width: 16, textAlign: 'center' }}>{i + 1}</Typography>
                        <Box sx={{
                          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                          bgcolor: `${SERIES_COLORS[i % SERIES_COLORS.length]}22`, color: SERIES_COLORS[i % SERIES_COLORS.length],
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700,
                        }}>
                          {(u.friendly_name || u.user || '?')[0].toUpperCase()}
                        </Box>
                        <Typography sx={{ flex: 1, fontWeight: 600, fontSize: '0.82rem', color: C.ink }}>{u.friendly_name || u.user}</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: C.rust, fontWeight: 600 }}>{u.total_plays} plays</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted, minWidth: 40, textAlign: 'right' }}>{fmtDuration(u.total_duration)}</Typography>
                      </Box>
                      <Box sx={{ pl: 5.5 }}>
                        <LinearProgress variant="determinate" value={Math.round((u.total_duration / maxUserDuration) * 100)} sx={{
                          height: 3, borderRadius: 99, bgcolor: C.surface,
                          '& .MuiLinearProgress-bar': { bgcolor: SERIES_COLORS[i % SERIES_COLORS.length], borderRadius: 99 },
                        }} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Top Content */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ContentTable label="Top Movies"   rows={topMovies} icon={<MovieIcon sx={{ fontSize: 14 }} />} />
                <ContentTable label="Top TV Shows" rows={topTV}     icon={<TvIcon    sx={{ fontSize: 14 }} />} />
              </Box>
            </Box>
            </>)}
          </Box>
        )}

        {/* ══════════════════ GRAPHS TAB ══════════════════ */}
        {activeTab === 'graphs' && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>All graphs use the same time range</Typography>
              <DaysToggle value={graphDays} onChange={setGraphDays} />
            </Box>

            {/* Daily plays — area chart */}
            <Box sx={{ mb: 3 }}>
              <ChartCard label="Daily Play Count by Media Type">
                {transformSeries(playsData, true).length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={transformSeries(playsData, true)} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        {activeSeriesKeys(playsData).map((key, i) => (
                          <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis allowDecimals={false} {...axisProps} />
                      <ChartTooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '0.75rem', color: C.muted }} />
                      {activeSeriesKeys(playsData).map((key, i) => (
                        <Area key={key} type="monotone" dataKey={key} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} fill={`url(#grad-${i})`} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>No play history data</Typography>
                  </Box>
                )}
              </ChartCard>
            </Box>

            {/* 2×2 grid of bar charts */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
              <ChartCard label="Play Count by Day of Week">
                {dowData?.categories?.length
                  ? <SeriesBarChart data={transformSeries(dowData)} keys={activeSeriesKeys(dowData)} />
                  : <Empty label="No data" />}
              </ChartCard>

              <ChartCard label="Play Count by Hour of Day">
                {hodData?.categories?.length
                  ? <SeriesBarChart data={transformSeries(hodData)} keys={activeSeriesKeys(hodData)} />
                  : <Empty label="No data" />}
              </ChartCard>

              <ChartCard label="Play Count by Top Platforms">
                {platformData?.categories?.length
                  ? <SeriesBarChart data={transformSeries(platformData)} keys={activeSeriesKeys(platformData)} />
                  : <Empty label="No data" />}
              </ChartCard>

              <ChartCard label="Play Count by Top Users">
                {topUsers.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={topUsers.map(u => ({ name: u.friendly_name || u.user || '?', plays: u.total_plays }))}
                      margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis allowDecimals={false} {...axisProps} />
                      <ChartTooltip {...tooltipStyle} />
                      <Bar dataKey="plays" fill={C.rust} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty label="No data" />}
              </ChartCard>
            </Box>
          </Box>
        )}

        {/* ══════════════════ HISTORY TAB ══════════════════ */}
        {activeTab === 'history' && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>
                {historyTotal > 0 ? `${historyTotal.toLocaleString()} entries` : ''}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: '0.78rem', color: C.muted }}>
                  Page {historyPage} of {totalPages || 1}
                </Typography>
                <IconButton onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <PrevIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))} disabled={historyPage >= totalPages} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <NextIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Box>
            </Box>

            <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
              {historyLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}>
                  <CircularProgress size={24} sx={{ color: C.rust }} />
                </Box>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Box sx={{ minWidth: 900 }}>
                    {/* Header */}
                    <Box sx={{
                      display: 'grid',
                      gridTemplateColumns: '100px 100px 110px 80px 140px 120px 1fr 60px 50px 60px 70px',
                      px: 2, py: 1,
                      borderBottom: `1px solid ${C.border}`,
                      bgcolor: C.surface,
                    }}>
                      {['Date', 'User', 'IP Address', 'Platform', 'Product', 'Player', 'Title', 'Started', 'Paused', 'Stopped', 'Duration'].map(h => (
                        <Typography key={h} sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {h}
                        </Typography>
                      ))}
                    </Box>
                    {/* Rows */}
                    {historyRows.map((row, i) => (
                      <Box key={row.id} sx={{
                        display: 'grid',
                        gridTemplateColumns: '100px 100px 110px 80px 140px 120px 1fr 60px 50px 60px 70px',
                        px: 2, py: 1, alignItems: 'center',
                        borderBottom: i < historyRows.length - 1 ? `1px solid ${C.border}` : 'none',
                        bgcolor: i % 2 === 0 ? 'transparent' : `${C.surface}60`,
                        '&:hover': { bgcolor: `${C.surface}cc` },
                      }}>
                        <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>{fmtUnixDate(row.date)}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: C.ink }}>{row.friendly_name || row.user}</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: 'monospace' }}>{row.ip_address}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: C.muted }}>{row.platform}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.72rem', color: C.muted }}>{row.product}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.72rem', color: C.muted }}>{row.player}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          {row.media_type === 'episode' ? <TvIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} /> : row.media_type === 'movie' ? <MovieIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} /> : <MusicIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} />}
                          <Tooltip title={historyTitle(row)} placement="top">
                            <Typography noWrap sx={{ fontSize: '0.78rem', color: C.ink, cursor: 'default' }}>{historyTitle(row)}</Typography>
                          </Tooltip>
                        </Box>
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtUnixTime(row.started)}</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.paused_counter ? `${Math.round(row.paused_counter / 60)}m` : '0m'}</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtUnixTime(row.stopped)}</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: C.ink, fontWeight: 500 }}>{fmtDuration(row.duration)}</Typography>
                      </Box>
                    ))}
                    {historyRows.length === 0 && (
                      <Box sx={{ py: 4, textAlign: 'center' }}>
                        <Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>No history</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>

            {/* Bottom pagination */}
            {totalPages > 1 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 2 }}>
                <IconButton onClick={() => setHistoryPage(1)} disabled={historyPage <= 1} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <PrevIcon sx={{ fontSize: 20 }} /><PrevIcon sx={{ fontSize: 20, ml: -1 }} />
                </IconButton>
                <IconButton onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <PrevIcon sx={{ fontSize: 20 }} />
                </IconButton>
                {Array.from({ length: Math.min(7, totalPages) }, (_, idx) => {
                  const start = Math.max(1, Math.min(historyPage - 3, totalPages - 6))
                  const p = start + idx
                  return (
                    <Box key={p} onClick={() => setHistoryPage(p)} sx={{
                      width: 28, height: 28, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: '0.78rem',
                      bgcolor: historyPage === p ? C.rustBg : 'transparent',
                      color:   historyPage === p ? C.rust : C.muted,
                      border:  `1px solid ${historyPage === p ? C.rust + '55' : 'transparent'}`,
                      '&:hover': { color: C.ink },
                    }}>
                      {p}
                    </Box>
                  )
                })}
                <IconButton onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))} disabled={historyPage >= totalPages} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <NextIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton onClick={() => setHistoryPage(totalPages)} disabled={historyPage >= totalPages} size="small"
                  sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}>
                  <NextIcon sx={{ fontSize: 20 }} /><NextIcon sx={{ fontSize: 20, ml: -1 }} />
                </IconButton>
              </Box>
            )}
          </Box>
        )}

        {/* ── USERS TAB ────────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <Suspense fallback={
            <Box sx={{ p: 5, textAlign: 'center' }}>
              <CircularProgress size={24} thickness={3} sx={{ color: C.rust }} />
            </Box>
          }>
            <PlexUsers />
          </Suspense>
        )}

        {/* ── LOGS TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'logs' && (
          <Box>
            {/* Controls row */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2, alignItems: 'center' }}>
              {/* Source sub-tabs */}
              <ToggleButtonGroup
                value={logSource}
                exclusive
                size="small"
                onChange={(_, v) => v && setLogSource(v as LogSource)}
                sx={{
                  '& .MuiToggleButton-root': {
                    // Unselected uses ink rather than muted: at this size muted
                    // reads as disabled rather than merely unselected.
                    px: 1.5, py: 0.5, textTransform: 'none', fontSize: '0.78rem',
                    color: C.ink, borderColor: C.border,
                    '&.Mui-selected': { bgcolor: C.rustBg, color: C.rust, borderColor: C.rust + '88', fontWeight: 600 },
                    '&.Mui-selected:hover': { bgcolor: C.rustBg },
                  },
                }}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="tautulli">Tautulli</ToggleButton>
                <ToggleButton value="plex">Plex</ToggleButton>
                <ToggleButton value="notifications">Notifications</ToggleButton>
              </ToggleButtonGroup>

              {/* Search */}
              <TextField
                size="small"
                placeholder="search message, user, action…"
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                sx={{
                  flex: 1, minWidth: 200,
                  '& .MuiOutlinedInput-root': { bgcolor: C.paper, fontSize: '0.82rem' },
                  '& input': { fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: '0.8rem' },
                }}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: C.muted }} /></InputAdornment>,
                }}
              />

              {/* Time range */}
              <FormControl size="small">
                <Select
                  value={logTimeRange}
                  onChange={e => setLogTimeRange(e.target.value as LogTimeRange)}
                  sx={{ bgcolor: C.paper, fontSize: '0.8rem', color: C.ink, minWidth: 110 }}
                >
                  <MenuItem value="1h">Last 1 h</MenuItem>
                  <MenuItem value="6h">Last 6 h</MenuItem>
                  <MenuItem value="24h">Last 24 h</MenuItem>
                  <MenuItem value="7d">Last 7 d</MenuItem>
                  <MenuItem value="all">All time</MenuItem>
                </Select>
              </FormControl>

              {/* Sort */}
              <FormControl size="small">
                <Select
                  value={logSortDir}
                  onChange={e => setLogSortDir(e.target.value as 'desc' | 'asc')}
                  sx={{ bgcolor: C.paper, fontSize: '0.8rem', color: C.ink, minWidth: 130 }}
                >
                  <MenuItem value="desc">Newest first</MenuItem>
                  <MenuItem value="asc">Oldest first</MenuItem>
                </Select>
              </FormControl>

              {/* Refresh + auto-refresh */}
              <Tooltip title="Refresh now">
                <IconButton onClick={fetchAllLogs} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
                  <RefreshIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={logAutoRefresh ? 'Auto-refresh on (30 s) — click to disable' : 'Enable auto-refresh (30 s)'}>
                <Box
                  onClick={() => setLogAutoRefresh(v => !v)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
                    px: 1, py: 0.3, borderRadius: '6px',
                    bgcolor: logAutoRefresh ? C.rustBg : 'transparent',
                    border: `1px solid ${logAutoRefresh ? C.rust + '66' : C.border}`,
                    color: logAutoRefresh ? C.rust : C.muted,
                    fontSize: '0.72rem', fontWeight: 600,
                    userSelect: 'none',
                    '&:hover': { color: C.rust },
                  }}
                >
                  <DotIcon sx={{ fontSize: 10, animation: logAutoRefresh ? 'pulse 1.5s infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }} />
                  Live
                </Box>
              </Tooltip>
            </Box>

            {/* Level filter chips */}
            <Box sx={{ display: 'flex', gap: 0.6, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.7rem', color: C.muted, mr: 0.5, fontWeight: 600, letterSpacing: '0.08em' }}>LEVEL</Typography>
              {(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'SUCCESS', 'FAILURE'] as LogLevel[]).map(level => {
                const active = logLevels.includes(level)
                const lc = levelColor(level, C)
                return (
                  <Chip
                    key={level}
                    label={level}
                    size="small"
                    onClick={() => setLogLevels(ls => ls.includes(level) ? ls.filter(l => l !== level) : [...ls, level])}
                    sx={{
                      height: 22, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
                      fontFamily: '"JetBrains Mono", monospace',
                      bgcolor: active ? lc + '22' : 'transparent',
                      color: active ? lc : C.muted,
                      border: `1px solid ${active ? lc + '77' : C.border}`,
                      '&:hover': { bgcolor: lc + '18', color: lc },
                    }}
                  />
                )
              })}
              {logLevels.length > 0 && (
                <Typography
                  onClick={() => setLogLevels([])}
                  sx={{ fontSize: '0.7rem', color: C.muted, cursor: 'pointer', ml: 0.5, '&:hover': { color: C.rust } }}
                >
                  clear
                </Typography>
              )}
            </Box>

            {/* Error banners per source */}
            {[
              { key: 'tautulli',     label: 'Tautulli',      err: tautulliError },
              { key: 'plex',         label: 'Plex',           err: plexError },
              { key: 'notif',        label: 'Notifications',  err: notifError },
            ].filter(s => s.err && (logSource === 'all' || logSource === (s.key === 'notif' ? 'notifications' : s.key))).map(s => (
              <Box key={s.key} sx={{ mb: 1, p: 1.5, bgcolor: C.red + '18', border: `1px solid ${C.red}44`, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningIcon sx={{ fontSize: 15, color: C.red, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.8rem', color: C.red }}>
                  {s.label}: {s.err}
                </Typography>
              </Box>
            ))}

            {/* Summary bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
                {'>'} {visibleLogs.length.toLocaleString()} entries{(logSearch || logLevels.length > 0 || logTimeRange !== 'all') ? ' (filtered)' : ''}
              </Typography>
              {logsLoading && <CircularProgress size={12} thickness={4} sx={{ color: C.rust }} />}
              {/* Per-source counts when showing all */}
              {logSource === 'all' && (
                <Box sx={{ display: 'flex', gap: 0.8, ml: 'auto', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Tautulli',   count: tautulliLogs.length,  loading: tautulliLoading },
                    { label: 'Plex API',   count: plexLogs.length,       loading: plexLoading },
                    { label: 'Notifs',     count: notifLogs.length,      loading: notifLoading },
                  ].map(s => (
                    <Typography key={s.label} sx={{ fontSize: '0.68rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
                      {s.label}: {s.loading ? '…' : s.count.toLocaleString()}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>

            {/* Log table */}
            <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
              {logsLoading && visibleLogs.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <CircularProgress size={24} thickness={3} sx={{ color: C.rust }} />
                  <Typography sx={{ mt: 1, fontSize: '0.8rem', color: C.muted }}>Loading logs…</Typography>
                </Box>
              ) : visibleLogs.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>
                    {logSearch || logLevels.length > 0 ? 'No entries match the current filters.' : 'No log entries found.'}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{
                  maxHeight: 'calc(100vh - 420px)',
                  minHeight: 300,
                  overflowY: 'auto',
                  '&::-webkit-scrollbar': { width: 6 },
                  '&::-webkit-scrollbar-track': { background: 'transparent' },
                  '&::-webkit-scrollbar-thumb': { background: C.border, borderRadius: 2 },
                }}>
                  {visibleLogs.map((row, i) => (
                    <LogLine key={row.id} row={row} isLast={i === visibleLogs.length - 1} C={C} />
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* ══════════════════ DUPLICATES TAB ══════════════════ */}
        {activeTab === 'duplicates' && (
          <Suspense fallback={
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
              <CircularProgress size={24} sx={{ color: C.rust }} />
            </Box>
          }>
            <DuplicatesTab C={C} />
          </Suspense>
        )}
      </Box>
    </Box>
  )
}

// ── Log line ─────────────────────────────────────────────────────────────
function levelColor(level: LogLevel, C: ReturnType<typeof useC>): string {
  switch ((level || '').toUpperCase()) {
    case 'ERROR':
    case 'CRITICAL': return C.red
    case 'WARNING':
    case 'WARN':     return C.amber
    case 'INFO':     return C.blue
    case 'SUCCESS':  return C.green
    case 'FAILURE':
    case 'FAIL':     return C.red
    case 'DEBUG':    return C.muted
    default:         return C.muted
  }
}

const SOURCE_ICON: Record<LogRow['source'], React.ReactNode> = {
  tautulli:      <ClockIcon sx={{ fontSize: 11 }} />,
  plex:          <PlayIcon  sx={{ fontSize: 11 }} />,
  notifications: <NotifIcon sx={{ fontSize: 11 }} />,
}

const SOURCE_LABEL: Record<LogRow['source'], string> = {
  tautulli:      'TAUTULLI',
  plex:          'PLEX',
  notifications: 'NOTIF',
}

// Per-action highlight config for notification rows.
const ACTION_STYLE: Record<string, { bg: string; bgHover: string; border: string; label: string; icon: string }> = {
  on_play:    { bg: 'rgba(124,174,106,0.14)', bgHover: 'rgba(124,174,106,0.26)', border: '#7CAE6A', label: 'PLAY',    icon: '▶' },
  on_resume:  { bg: 'rgba(124,174,106,0.14)', bgHover: 'rgba(124,174,106,0.26)', border: '#7CAE6A', label: 'RESUME',  icon: '▶' },
  on_pause:   { bg: 'rgba(196,160,64,0.14)',  bgHover: 'rgba(196,160,64,0.26)',  border: '#C4A040', label: 'PAUSE',   icon: '⏸' },
  on_stop:    { bg: 'rgba(178,89,69,0.10)',   bgHover: 'rgba(178,89,69,0.20)',   border: '#B05945', label: 'STOP',    icon: '■' },
  on_buffer:  { bg: 'rgba(250,204,21,0.12)',  bgHover: 'rgba(250,204,21,0.22)',  border: '#FACC15', label: 'BUFFER',  icon: '⏳' },
  on_watched: { bg: 'rgba(122,168,196,0.14)', bgHover: 'rgba(122,168,196,0.26)', border: '#7AA8C4', label: 'WATCHED', icon: '✓' },
  on_error:   { bg: 'rgba(212,122,106,0.14)', bgHover: 'rgba(212,122,106,0.26)', border: '#D47A6A', label: 'ERROR',   icon: '✕' },
}

function LogLine({ row, isLast, C }: { row: LogRow; isLast: boolean; C: ReturnType<typeof useC> }) {
  const [copied, setCopied] = useState(false)
  const lc = levelColor(row.level, C)
  const MONO = '"JetBrains Mono", "Fira Code", monospace'

  // Action-based highlight for notification rows takes priority; buffering
  // text match is a fallback that also catches non-notification sources (e.g.
  // a Plex server log line that says "is buffering").
  const actionStyle = row.source === 'notifications' && row.action
    ? ACTION_STYLE[row.action] ?? null
    : null

  const isBufferingText = !actionStyle && /buffering/i.test(
    [row.message, row.subject, row.detail].filter(Boolean).join(' ')
  )

  // Active style: action wins, then buffering text, then plain.
  const hs = actionStyle ?? (isBufferingText
    ? { bg: 'rgba(250,204,21,0.12)', bgHover: 'rgba(250,204,21,0.22)', border: '#FACC15', label: '', icon: '' }
    : null)

  const copyText = [row.timestamp, `[${row.source.toUpperCase()}]`, `[${row.level}]`, row.message, row.detail].filter(Boolean).join(' ')
  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1,
      px: 2, py: 0.9,
      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
      ...(hs ? {
        bgcolor:    hs.bg,
        borderTop: `2px solid ${hs.border}`,
      } : {}),
      '&:hover': { bgcolor: hs ? hs.bgHover : C.surface + 'BB' },
      '&:hover .copy-btn': { opacity: 1 },
      transition: 'background-color 0.1s',
    }}>
      {/* Timestamp */}
      <Typography sx={{
        fontSize: '0.68rem', color: C.muted, fontFamily: MONO,
        minWidth: 145, flexShrink: 0, mt: 0.1, lineHeight: 1.5,
      }}>
        {row.timestamp || '—'}
      </Typography>

      {/* Source badge */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.3,
        bgcolor: C.surface, border: `1px solid ${C.border}`,
        px: 0.5, py: 0.05, borderRadius: '4px',
        color: C.muted, minWidth: 58, justifyContent: 'center', flexShrink: 0, mt: 0.05,
      }}>
        {SOURCE_ICON[row.source]}
        <Typography sx={{ fontSize: '0.6rem', fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em' }}>
          {SOURCE_LABEL[row.source]}
        </Typography>
      </Box>

      {/* Level badge */}
      <Typography sx={{
        fontSize: '0.68rem', fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em',
        color: lc, minWidth: 64, flexShrink: 0, mt: 0.1, lineHeight: 1.5,
      }}>
        [{row.level || '?'}]
      </Typography>

      {/* Thread (tautulli/plex only) */}
      {row.thread && (
        <Typography sx={{
          fontSize: '0.68rem', color: C.muted, fontFamily: MONO,
          minWidth: 90, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', flexShrink: 0, mt: 0.1, lineHeight: 1.5,
        }}>
          {row.thread}
        </Typography>
      )}

      {/* Main message */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontSize: '0.78rem', fontFamily: MONO, color: C.ink, lineHeight: 1.5,
          wordBreak: 'break-all',
        }}>
          {row.message}
        </Typography>
        {/* Notification extras — action badge + metadata */}
        {row.source === 'notifications' && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 0.5, alignItems: 'center' }}>
            {/* Action badge */}
            {actionStyle && (
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.4,
                px: 0.75, py: 0.15, borderRadius: '4px',
                bgcolor: actionStyle.bg,
                border: `1px solid ${actionStyle.border}88`,
                color: actionStyle.border,
                fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
                letterSpacing: '0.06em',
              }}>
                {actionStyle.icon} {actionStyle.label}
              </Box>
            )}
            {row.notifier && (
              <Typography sx={{ fontSize: '0.68rem', color: C.muted, fontFamily: MONO }}>
                via {row.notifier}
              </Typography>
            )}
            {row.user && (
              <Typography sx={{ fontSize: '0.68rem', color: C.muted, fontFamily: MONO }}>
                · user: {row.user}
              </Typography>
            )}
            {row.detail && (
              <Typography sx={{
                fontSize: '0.7rem', color: C.muted, fontFamily: MONO,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', width: '100%', mt: 0.2,
              }}>
                {row.detail}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Copy button — appears on hover */}
      <Tooltip title={copied ? 'Copied!' : 'Copy line'}>
        <IconButton
          className="copy-btn"
          onClick={handleCopy}
          size="small"
          sx={{
            opacity: 0, flexShrink: 0, color: copied ? C.green : C.muted, p: 0.3,
            transition: 'opacity 0.15s',
            '&:hover': { color: C.rust },
          }}
        >
          <CopyIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

// ── Library Detail View ───────────────────────────────────────────────────
type LibTab = 'profile' | 'history' | 'media-info' | 'playlists'

interface LibraryPlaylist {
  ratingKey:      string
  title:          string
  summary?:       string
  playlistType:   string
  smart:          boolean
  totalItems:     number
  itemsInLibrary: number
  duration:       number   // ms
  addedAt:        number   // unix sec
  updatedAt:      number   // unix sec
  thumb?:         string | null
}

// Items inside a playlist, as returned by Plex's /playlists/:id/items
interface PlaylistItem {
  ratingKey:        string
  title:            string
  type:             string   // 'movie' | 'episode' | 'track' | ...
  year?:            number
  thumb?:           string
  art?:             string
  duration?:        number   // ms
  viewCount?:       number
  grandparentTitle?: string  // for episodes (show name)
  parentTitle?:     string   // for episodes (season)
  index?:           number   // episode number
  parentIndex?:     number   // season number
  librarySectionID?: number
}

// Map a Plex library section_type to the matching playlistType.
function playlistTypeFor(sectionType: string): string {
  switch (sectionType) {
    case 'artist': return 'audio'
    case 'photo':  return 'photo'
    default:       return 'video'   // movie / show / homevideo / mixed
  }
}

function LibraryDetailView({ library, onBack }: { library: Library; onBack: () => void }) {
  const C            = useC()
  const SERIES_COLORS = useSeriesColors()

  const [tab,              setTab]              = useState<LibTab>('profile')
  const [watchStats,       setWatchStats]       = useState<WatchStat[]>([])
  const [userStats,        setUserStats]        = useState<LibUserStat[]>([])
  const [recentlyAdded,    setRecentlyAdded]    = useState<RecentItem[]>([])
  const [recentlyPlayed,   setRecentlyPlayed]   = useState<HistoryRow[]>([])
  const [profileLoading,   setProfileLoading]   = useState(true)
  const [historyRows,      setHistoryRows]      = useState<HistoryRow[]>([])
  const [historyTotal,     setHistoryTotal]     = useState(0)
  const [historyPage,      setHistoryPage]      = useState(1)
  const [historyLoading,   setHistoryLoading]   = useState(false)
  const [mediaInfoRows,    setMediaInfoRows]    = useState<MediaInfoRow[]>([])
  const [mediaInfoTotal,   setMediaInfoTotal]   = useState(0)
  const [mediaInfoPage,    setMediaInfoPage]    = useState(1)
  const [mediaInfoLoading, setMediaInfoLoading] = useState(false)
  const [playlists,        setPlaylists]        = useState<LibraryPlaylist[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [playlistsError,   setPlaylistsError]   = useState<string | null>(null)
  const [openPlaylist,     setOpenPlaylist]     = useState<LibraryPlaylist | null>(null)
  const [playlistItems,    setPlaylistItems]    = useState<PlaylistItem[]>([])
  const [itemsLoading,     setItemsLoading]     = useState(false)
  const [itemsError,       setItemsError]       = useState<string | null>(null)
  const historyLoaded   = useRef(false)
  const mediaInfoLoaded = useRef(false)
  const playlistsLoaded = useRef(false)
  const id = library.section_id

  useEffect(() => {
    setProfileLoading(true)
    Promise.all([
      apiClient.fetch(`/api/tautulli/library/${id}/watch-stats`),
      apiClient.fetch(`/api/tautulli/library/${id}/user-stats`),
      apiClient.fetch(`/api/tautulli/library/${id}/recently-added`),
      apiClient.fetch(`/api/tautulli/library/${id}/history?page=1&length=12`),
    ]).then(async ([wsR, usR, raR, rpR]) => {
      if (wsR.ok) setWatchStats(await wsR.json())
      if (usR.ok) setUserStats(await usR.json())
      if (raR.ok) setRecentlyAdded(await raR.json())
      if (rpR.ok) { const d = await rpR.json(); setRecentlyPlayed(d.data ?? []) }
    }).finally(() => setProfileLoading(false))
  }, [id])

  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    try {
      const r = await apiClient.fetch(`/api/tautulli/library/${id}/history?page=${page}&length=25`)
      if (r.ok) { const d = await r.json(); setHistoryRows(d.data); setHistoryTotal(d.total) }
    } finally { setHistoryLoading(false) }
  }, [id])

  const fetchMediaInfo = useCallback(async (page: number, refresh = false) => {
    setMediaInfoLoading(true)
    try {
      const qs = `page=${page}&length=25${refresh ? '&refresh=1' : ''}`
      const r = await apiClient.fetch(`/api/tautulli/library/${id}/media-info?${qs}`)
      if (r.ok) { const d = await r.json(); setMediaInfoRows(d.data); setMediaInfoTotal(d.total) }
    } finally { setMediaInfoLoading(false) }
  }, [id])

  useEffect(() => {
    if (tab === 'history' && !historyLoaded.current) { historyLoaded.current = true; fetchHistory(1) }
  }, [tab, fetchHistory])
  useEffect(() => { if (historyLoaded.current) fetchHistory(historyPage) }, [historyPage, fetchHistory])

  useEffect(() => {
    if (tab === 'media-info' && !mediaInfoLoaded.current) { mediaInfoLoaded.current = true; fetchMediaInfo(1) }
  }, [tab, fetchMediaInfo])
  useEffect(() => { if (mediaInfoLoaded.current) fetchMediaInfo(mediaInfoPage) }, [mediaInfoPage, fetchMediaInfo])

  const fetchPlaylists = useCallback(async () => {
    setPlaylistsLoading(true)
    setPlaylistsError(null)
    try {
      const r = await apiClient.fetch(`/api/plex/library/${id}/playlists?type=${playlistTypeFor(library.section_type)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setPlaylists(d.playlists ?? [])
    } catch (e) {
      setPlaylistsError(e instanceof Error ? e.message : 'Failed to load playlists')
      setPlaylists([])
    } finally {
      setPlaylistsLoading(false)
    }
  }, [id, library.section_type])

  useEffect(() => {
    if (tab === 'playlists' && !playlistsLoaded.current) { playlistsLoaded.current = true; fetchPlaylists() }
  }, [tab, fetchPlaylists])

  // Open a playlist popout: fetch its items via the existing
  // /api/plex/playlists/:id/items endpoint. Items are shown in a poster grid
  // matching the Recently Added look.
  useEffect(() => {
    if (!openPlaylist) return
    let cancelled = false
    setItemsLoading(true)
    setItemsError(null)
    setPlaylistItems([])
    apiClient.fetch(`/api/plex/playlists/${openPlaylist.ratingKey}/items`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        if (cancelled) return
        setPlaylistItems(d?.MediaContainer?.Metadata ?? [])
      })
      .catch(e => {
        if (cancelled) return
        setItemsError(e instanceof Error ? e.message : 'Failed to load items')
      })
      .finally(() => { if (!cancelled) setItemsLoading(false) })
    return () => { cancelled = true }
  }, [openPlaylist])

  const histTotalPages  = Math.ceil(historyTotal  / 25)
  const mediaTotalPages = Math.ceil(mediaInfoTotal / 25)

  const HIST_COLS  = '100px 100px 110px 80px 140px 120px 1fr 60px 50px 60px 70px'
  const MEDIA_COLS = '90px 1fr 60px 80px 80px 85px 60px 70px 65px 90px 90px 55px'

  return (
    <Box>
      {/* Back + title */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box onClick={onBack} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.muted, fontSize: '0.82rem', '&:hover': { color: C.rust } }}>
          <PrevIcon sx={{ fontSize: 18 }} /> Libraries
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ color: C.rust, display: 'flex' }}>{libraryIcon(library.section_type)}</Box>
          <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', color: C.ink }}>{library.section_name}</Typography>
        </Box>
      </Box>

      {/* Sub-tabs */}
      <Box sx={{ display: 'flex', gap: 0, mb: 2.5, borderBottom: `1px solid ${C.border}` }}>
        {(['profile', 'history', 'media-info', 'playlists'] as LibTab[]).map(t => (
          <Box key={t} onClick={() => setTab(t)} sx={{
            px: 2, py: 0.75, cursor: 'pointer', fontSize: '0.82rem',
            fontWeight: tab === t ? 600 : 400,
            color: tab === t ? C.rust : C.muted,
            borderBottom: tab === t ? `2px solid ${C.rust}` : '2px solid transparent',
            '&:hover': { color: tab === t ? C.rust : C.ink },
          }}>
            {t === 'media-info' ? 'Media Info' : t === 'playlists' ? 'Playlist' : t.charAt(0).toUpperCase() + t.slice(1)}
          </Box>
        ))}
      </Box>

      {/* ── Profile ── */}
      {tab === 'profile' && (
        profileLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: C.rust }} /></Box>
        ) : (
          <Box>
            {/* Global Stats */}
            <SectionHeader label="Global Stats" />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 1.5, mb: 3 }}>
              {watchStats.map(ws => {
                const label = ws.query_days === 1 ? 'Last 24 Hours' : ws.query_days === 7 ? 'Last 7 Days' : ws.query_days === 30 ? 'Last 30 Days' : 'All Time'
                return (
                  <Box key={ws.query_days} sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2 }}>
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>{label}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, color: C.rust, lineHeight: 1 }}>{ws.total_plays}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>plays</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.75rem', color: C.muted, mt: 0.25 }}>{fmtDurationLong(ws.total_duration)}</Typography>
                  </Box>
                )
              })}
            </Box>

            {/* User Stats */}
            {userStats.length > 0 && (<>
              <SectionHeader label="User Stats" />
              <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 2.5, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {userStats.map((u, i) => (
                    <Box key={u.user_id ?? u.user} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, bgcolor: `${SERIES_COLORS[i % SERIES_COLORS.length]}25`, color: SERIES_COLORS[i % SERIES_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem' }}>
                        {(u.friendly_name || u.user || '?')[0].toUpperCase()}
                      </Box>
                      <Box>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', color: C.ink }}>{u.friendly_name || u.user}</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: C.rust, fontWeight: 600 }}>{u.total_plays} plays</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </>)}

            {/* Recently Played */}
            {recentlyPlayed.length > 0 && (<>
              <SectionHeader label="Recently Played" />
              <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1.5, mb: 3, '&::-webkit-scrollbar': { height: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: C.border, borderRadius: 99 } }}>
                {recentlyPlayed.map(row => {
                  const thumb = row.thumb ? `/api/tautulli/image?img=${encodeURIComponent(row.thumb)}&width=100&height=150` : null
                  const title = row.media_type === 'episode' ? (row.grandparent_title || row.full_title) : row.full_title
                  return (
                    <Box key={row.id} sx={{ flexShrink: 0, width: 100 }}>
                      <Box sx={{ width: 100, height: 150, borderRadius: '8px', overflow: 'hidden', bgcolor: C.surface, mb: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumb ? <AuthenticatedImage source={thumb} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <MovieIcon sx={{ color: C.muted, fontSize: 28 }} />}
                      </Box>
                      <Tooltip title={title} placement="top">
                        <Typography noWrap sx={{ fontSize: '0.72rem', fontWeight: 600, color: C.ink }}>{title}</Typography>
                      </Tooltip>
                      <Typography sx={{ fontSize: '0.65rem', color: C.muted }}>{timeAgo(row.date)}</Typography>
                    </Box>
                  )
                })}
              </Box>
            </>)}

            {/* Recently Added */}
            {recentlyAdded.length > 0 && (<>
              <SectionHeader label="Recently Added" />
              <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1.5, '&::-webkit-scrollbar': { height: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: C.border, borderRadius: 99 } }}>
                {recentlyAdded.map(item => {
                  const thumb = item.thumb ? `/api/tautulli/image?img=${encodeURIComponent(item.thumb)}&width=100&height=150` : null
                  return (
                    <Box key={item.rating_key} sx={{ flexShrink: 0, width: 100 }}>
                      <Box sx={{ width: 100, height: 150, borderRadius: '8px', overflow: 'hidden', bgcolor: C.surface, mb: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumb ? <AuthenticatedImage source={thumb} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <MovieIcon sx={{ color: C.muted, fontSize: 28 }} />}
                      </Box>
                      <Tooltip title={item.title} placement="top">
                        <Typography noWrap sx={{ fontSize: '0.72rem', fontWeight: 600, color: C.ink }}>{item.title}</Typography>
                      </Tooltip>
                      <Typography sx={{ fontSize: '0.65rem', color: C.muted }}>{timeAgo(item.added_at)}</Typography>
                    </Box>
                  )
                })}
              </Box>
            </>)}
          </Box>
        )
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>{historyTotal > 0 ? `${historyTotal.toLocaleString()} entries` : ''}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.78rem', color: C.muted }}>Page {historyPage} of {histTotalPages || 1}</Typography>
              <IconButton onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} size="small" sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}><PrevIcon sx={{ fontSize: 20 }} /></IconButton>
              <IconButton onClick={() => setHistoryPage(p => Math.min(histTotalPages, p + 1))} disabled={historyPage >= histTotalPages} size="small" sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}><NextIcon sx={{ fontSize: 20 }} /></IconButton>
            </Box>
          </Box>
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
            {historyLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} sx={{ color: C.rust }} /></Box>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 900 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: HIST_COLS, px: 2, py: 1, borderBottom: `1px solid ${C.border}`, bgcolor: C.surface }}>
                    {['Date','User','IP Address','Platform','Product','Player','Title','Started','Paused','Stopped','Duration'].map(h => (
                      <Typography key={h} sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</Typography>
                    ))}
                  </Box>
                  {historyRows.map((row, i) => (
                    <Box key={row.id} sx={{ display: 'grid', gridTemplateColumns: HIST_COLS, px: 2, py: 1, alignItems: 'center', borderBottom: i < historyRows.length - 1 ? `1px solid ${C.border}` : 'none', bgcolor: i % 2 === 0 ? 'transparent' : `${C.surface}60`, '&:hover': { bgcolor: `${C.surface}cc` } }}>
                      <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>{fmtUnixDate(row.date)}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: C.ink }}>{row.friendly_name || row.user}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: 'monospace' }}>{row.ip_address}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: C.muted }}>{row.platform}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: C.muted }}>{row.product}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: C.muted }}>{row.player}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        {row.media_type === 'episode' ? <TvIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} /> : row.media_type === 'movie' ? <MovieIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} /> : <MusicIcon sx={{ fontSize: 13, color: C.muted, flexShrink: 0 }} />}
                        <Tooltip title={historyTitle(row)} placement="top">
                          <Typography noWrap sx={{ fontSize: '0.78rem', color: C.ink }}>{historyTitle(row)}</Typography>
                        </Tooltip>
                      </Box>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtUnixTime(row.started)}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.paused_counter ? `${Math.round(row.paused_counter / 60)}m` : '0m'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtUnixTime(row.stopped)}</Typography>
                      <Typography sx={{ fontSize: '0.75rem', color: C.ink, fontWeight: 500 }}>{fmtDuration(row.duration)}</Typography>
                    </Box>
                  ))}
                  {historyRows.length === 0 && <Box sx={{ py: 4, textAlign: 'center' }}><Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>No history</Typography></Box>}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Media Info ── */}
      {tab === 'media-info' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>{mediaInfoTotal > 0 ? `${mediaInfoTotal.toLocaleString()} items` : ''}</Typography>
              <Tooltip title="Force Tautulli to rebuild its cache for this library (may take 30-90s for large libraries). Use this if recently-added items aren't showing up." placement="top">
                <Button
                  onClick={() => { setMediaInfoPage(1); fetchMediaInfo(1, true) }}
                  disabled={mediaInfoLoading}
                  size="small"
                  startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
                  sx={{
                    color: C.muted, textTransform: 'none', fontSize: '0.72rem',
                    fontWeight: 500, py: 0.25, px: 1, minWidth: 'auto',
                    '&:hover': { color: C.rust, bgcolor: 'transparent' },
                    '&.Mui-disabled': { color: C.muted, opacity: 0.5 },
                  }}
                >
                  {mediaInfoLoading ? 'Refreshing…' : 'Refresh cache'}
                </Button>
              </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.78rem', color: C.muted }}>Page {mediaInfoPage} of {mediaTotalPages || 1}</Typography>
              <IconButton onClick={() => setMediaInfoPage(p => Math.max(1, p - 1))} disabled={mediaInfoPage <= 1} size="small" sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}><PrevIcon sx={{ fontSize: 20 }} /></IconButton>
              <IconButton onClick={() => setMediaInfoPage(p => Math.min(mediaTotalPages, p + 1))} disabled={mediaInfoPage >= mediaTotalPages} size="small" sx={{ color: C.muted, '&:not(:disabled):hover': { color: C.rust } }}><NextIcon sx={{ fontSize: 20 }} /></IconButton>
            </Box>
          </Box>
          <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
            {mediaInfoLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} sx={{ color: C.rust }} /></Box>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 1100 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: MEDIA_COLS, px: 2, py: 1, borderBottom: `1px solid ${C.border}`, bgcolor: C.surface }}>
                    {['Added','Title','Format','Bitrate','Video','Resolution','FPS','Audio','Ch','File Size','Last Played','Plays'].map(h => (
                      <Typography key={h} sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</Typography>
                    ))}
                  </Box>
                  {mediaInfoRows.map((row, i) => (
                    <Box key={row.rating_key} sx={{ display: 'grid', gridTemplateColumns: MEDIA_COLS, px: 2, py: 1, alignItems: 'center', borderBottom: i < mediaInfoRows.length - 1 ? `1px solid ${C.border}` : 'none', bgcolor: i % 2 === 0 ? 'transparent' : `${C.surface}60`, '&:hover': { bgcolor: `${C.surface}cc` } }}>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtUnixDate(row.added_at)}</Typography>
                      <Box sx={{ minWidth: 0 }}>
                        <Tooltip title={`${row.title}${row.year ? ` (${row.year})` : ''}`} placement="top">
                          <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.ink }}>{row.title}</Typography>
                        </Tooltip>
                        {row.year > 0 && <Typography sx={{ fontSize: '0.68rem', color: C.muted }}>{row.year}</Typography>}
                      </Box>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted, textTransform: 'uppercase' }}>{row.container || '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.bitrate ? `${row.bitrate} kbps` : '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted, textTransform: 'uppercase' }}>{row.video_codec || '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.video_resolution ? `${row.video_resolution}p` : '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.video_framerate || '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted, textTransform: 'uppercase' }}>{row.audio_codec || '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.audio_channels ? `${row.audio_channels}ch` : '—'}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtBytes(row.file_size)}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{row.last_played ? fmtUnixDate(row.last_played) : '—'}</Typography>
                      <Typography sx={{ fontSize: '0.75rem', fontWeight: row.play_count > 0 ? 600 : 400, color: row.play_count > 0 ? C.rust : C.muted }}>{row.play_count || 0}</Typography>
                    </Box>
                  ))}
                  {mediaInfoRows.length === 0 && <Box sx={{ py: 4, textAlign: 'center' }}><Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>No media info</Typography></Box>}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Playlists ── */}
      {tab === 'playlists' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>
              {playlistsLoading ? '' : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'} containing items from this library`}
            </Typography>
            <IconButton onClick={() => { playlistsLoaded.current = true; fetchPlaylists() }} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {playlistsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} sx={{ color: C.rust }} /></Box>
          ) : playlistsError ? (
            <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 3, textAlign: 'center' }}>
              <Typography sx={{ color: C.muted, fontSize: '0.85rem' }}>Failed to load playlists: {playlistsError}</Typography>
            </Box>
          ) : playlists.length === 0 ? (
            <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, p: 4, textAlign: 'center' }}>
              <PlaylistIcon sx={{ fontSize: 40, color: C.muted, mb: 1, opacity: 0.5 }} />
              <Typography sx={{ color: C.muted, fontSize: '0.9rem' }}>No playlists contain items from this library.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1.5 }}>
              {playlists.map(p => {
                const allInLib = p.itemsInLibrary === p.totalItems
                return (
                  <Box key={p.ratingKey} onClick={() => setOpenPlaylist(p)} sx={{
                    ...C.cardSx, borderRadius: CARD_RADIUS,
                    p: 2, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer',
                    transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
                    '&:hover': {
                      borderColor: C.rust,
                      transform: 'translateY(-1px)',
                      boxShadow: `0 4px 12px ${C.border}`,
                    },
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Box sx={{ color: C.rust, display: 'flex', flexShrink: 0, mt: 0.25 }}>
                        {p.smart ? <SmartIcon sx={{ fontSize: 18 }} /> : <PlaylistIcon sx={{ fontSize: 18 }} />}
                      </Box>
                      <Tooltip title={p.summary || p.title} placement="top">
                        <Typography sx={{ flex: 1, fontSize: '0.92rem', fontWeight: 600, color: C.ink, lineHeight: 1.25, wordBreak: 'break-word' }}>
                          {p.title}
                        </Typography>
                      </Tooltip>
                      {p.smart && (
                        <Chip label="Smart" size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: `${C.rust}22`, color: C.rust, '& .MuiChip-label': { px: 0.75 } }} />
                      )}
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.rust }}>{p.itemsInLibrary}</Typography>
                        {!allInLib && (
                          <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>/ {p.totalItems}</Typography>
                        )}
                        <Typography sx={{ fontSize: '0.72rem', color: C.muted, ml: 0.25 }}>
                          {p.itemsInLibrary === 1 ? 'item' : 'items'}
                        </Typography>
                      </Box>
                      {p.duration > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <ClockIcon sx={{ fontSize: 12, color: C.muted }} />
                          <Typography sx={{ fontSize: '0.72rem', color: C.muted }}>{fmtDuration(Math.floor(p.duration / 1000))}</Typography>
                        </Box>
                      )}
                      {p.updatedAt > 0 && (
                        <Typography sx={{ fontSize: '0.7rem', color: C.muted, ml: 'auto' }}>Updated {fmtUnixDate(p.updatedAt)}</Typography>
                      )}
                    </Box>

                    {p.summary && (
                      <Typography sx={{ fontSize: '0.74rem', color: C.muted, lineHeight: 1.4,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {p.summary}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      )}

      {/* ── Playlist items popout ── */}
      <Dialog
        open={!!openPlaylist}
        onClose={() => setOpenPlaylist(null)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { ...C.cardSx, borderRadius: CARD_RADIUS, backgroundImage: 'none' } }}
      >
        {openPlaylist && (
          <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2.5, borderBottom: `1px solid ${C.border}` }}>
              <Box sx={{ color: C.rust, display: 'flex' }}>
                {openPlaylist.smart ? <SmartIcon sx={{ fontSize: 22 }} /> : <PlaylistIcon sx={{ fontSize: 22 }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', color: C.ink, lineHeight: 1.2 }}>
                  {openPlaylist.title}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>
                    {openPlaylist.totalItems} {openPlaylist.totalItems === 1 ? 'item' : 'items'}
                  </Typography>
                  {openPlaylist.duration > 0 && (
                    <Typography sx={{ fontSize: '0.75rem', color: C.muted }}>
                      · {fmtDuration(Math.floor(openPlaylist.duration / 1000))}
                    </Typography>
                  )}
                  {openPlaylist.smart && (
                    <Chip label="Smart" size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: `${C.rust}22`, color: C.rust, '& .MuiChip-label': { px: 0.75 } }} />
                  )}
                </Box>
                {openPlaylist.summary && (
                  <Typography sx={{ fontSize: '0.78rem', color: C.muted, mt: 0.75, lineHeight: 1.4 }}>
                    {openPlaylist.summary}
                  </Typography>
                )}
              </Box>
              <IconButton onClick={() => setOpenPlaylist(null)} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
                <CloseIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Box>

            {/* Body */}
            <Box sx={{ p: 2.5, maxHeight: '70vh', overflowY: 'auto' }}>
              {itemsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress size={28} sx={{ color: C.rust }} />
                </Box>
              ) : itemsError ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography sx={{ color: C.muted, fontSize: '0.85rem' }}>Failed to load items: {itemsError}</Typography>
                </Box>
              ) : playlistItems.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography sx={{ color: C.muted, fontSize: '0.85rem' }}>No items in this playlist.</Typography>
                </Box>
              ) : (
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                  gap: 1.5,
                }}>
                  {playlistItems.map(item => {
                    const thumb = item.thumb
                      ? `/api/plex/image?path=${encodeURIComponent(item.thumb)}`
                      : null
                    const isEpisode = item.type === 'episode'
                    const titleLine = isEpisode && item.grandparentTitle ? item.grandparentTitle : item.title
                    const subLine = isEpisode
                      ? `S${item.parentIndex ?? '?'}E${item.index ?? '?'} · ${item.title}`
                      : (item.year ? String(item.year) : '')
                    return (
                      <Box key={item.ratingKey} sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{
                          width: '100%', aspectRatio: '2 / 3', borderRadius: '8px', overflow: 'hidden',
                          bgcolor: C.surface, mb: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          position: 'relative',
                        }}>
                          {thumb ? (
                            <AuthenticatedImage
                              source={thumb}
                              alt=""
                              loading="lazy"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <MovieIcon sx={{ color: C.muted, fontSize: 28 }} />
                          )}
                          {(item.viewCount ?? 0) > 0 && (
                            <Box sx={{
                              position: 'absolute', top: 4, right: 4,
                              bgcolor: `${C.rust}dd`, color: '#fff',
                              fontSize: '0.6rem', fontWeight: 700,
                              borderRadius: '4px', px: 0.6, py: 0.1,
                              display: 'flex', alignItems: 'center', gap: 0.25,
                            }}>
                              <PlayIcon sx={{ fontSize: 10 }} />
                              {item.viewCount}
                            </Box>
                          )}
                        </Box>
                        <Tooltip title={isEpisode ? `${titleLine} — ${item.title}` : titleLine} placement="top">
                          <Typography noWrap sx={{ fontSize: '0.74rem', fontWeight: 600, color: C.ink, lineHeight: 1.2 }}>
                            {titleLine}
                          </Typography>
                        </Tooltip>
                        {subLine && (
                          <Typography noWrap sx={{ fontSize: '0.66rem', color: C.muted, mt: 0.1 }}>
                            {subLine}
                          </Typography>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Dialog>
    </Box>
  )
}

// ── Shared content table (top movies / top TV) ────────────────────────────
function ContentTable({ label, rows, icon }: { label: string; rows: StatRow[]; icon: React.ReactNode }) {
  const C = useC()
  return (
    <Box>
      <SectionHeader label={label} />
      <Box sx={{ ...C.cardSx, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
        {rows.length === 0 && <Box sx={{ p: 2 }}><Empty label="No data" /></Box>}
        {rows.slice(0, 8).map((row, i) => {
          const title = row.grandparent_title || row.title || '—'
          return (
            <Box key={i} sx={{
              px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5,
              borderBottom: i < Math.min(rows.length, 8) - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <Box sx={{ color: C.muted, display: 'flex' }}>{icon}</Box>
              <Typography noWrap sx={{ flex: 1, fontSize: '0.82rem', color: C.ink }}>{title}</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: C.rust, fontWeight: 600, flexShrink: 0 }}>{row.total_plays} plays</Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
