import { apiClient } from '../services/apiClient'
import { AuthenticatedImage } from '../services/authenticatedImage'
// Tautulli Users dashboard — list all users and click through to a per-user
// profile with global stats, player breakdown, recently played, and history.
// Matches the layout shown in Tautulli's /users pages, restyled in the warm
// artisan palette.

import { CARD_RADIUS } from '../theme/controls'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useThemeMode } from '../context/ThemeContext'
import { tokensFor } from '../theme/tokens'
import { withAlpha } from '../theme/contrast'
import {
  Box, Typography, CircularProgress, IconButton, Tooltip, Chip,
} from '@mui/material'
import {
  ArrowBack as BackIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
  Devices as DevicesIcon,
  History as HistoryIcon,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
} from '../components/AppIcons'// ── Palette ───────────────────────────────────────────────────────────────
// Neutrals and accent from the tokens in force, so the palette pinned to the
// Plex page reaches this panel too. Semantic status colours stay fixed.
function useC() {
  const { mode, palette } = useThemeMode()
  const d = mode === 'dark'
  const t = tokensFor(d, palette)
  const accent = d ? t.rustLight : t.rustDark
  return {
    bg:     t.bg,
    surface:t.surface,
    paper:  t.paper,
    border: t.line,
    ink:    t.ink,
    muted:  t.muted,
    rust:   accent,
    rustBg: withAlpha(accent, d ? 0.18 : 0.10),
    green:  d ? '#7CAE6A' : '#4F7A3E',
    red:    d ? '#D47A6A' : '#B05945',
    blue:   d ? '#7AA8C4' : '#4A7A9B',
    amber:  d ? '#C4A040' : '#9A7A20',
    purple: d ? '#9E86C8' : '#6B5A9A',
  }
}

const SERIF = 'var(--hearth-heading)'
const MONO  = '"JetBrains Mono", "Fira Code", monospace'

// ── Types ─────────────────────────────────────────────────────────────────
interface TautulliUser {
  user_id:          number
  username:         string
  friendly_name:    string
  thumb:            string          // plex.tv CDN URL
  is_active:        number
  last_seen:        number | null   // unix seconds
  last_played:      string | null
  last_platform:    string | null
  last_player:      string | null
  last_ip:          string | null
  plays:            number
  duration:         number          // seconds
}

interface WatchTimeStat {
  query_days:  number    // 1 = 24 h, 7, 30, 0 = all time
  total_plays: number
  total_time:  number    // seconds
}

interface PlayerStat {
  total_plays:   number
  platform_type: string  // "android", "roku", etc.
  player:        string  // device display name
  platform:      string
}

interface HistoryRow {
  rating_key:       string
  grandparent_title:string
  parent_title:     string
  title:            string
  media_type:       string
  thumb:            string
  date:             number   // unix
  duration:         number   // seconds
  platform:         string
  player:           string
  paused_counter:   number
  watched_status:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────
function timeAgo(unix: number | null): string {
  if (!unix) return 'never'
  const sec = Math.floor((Date.now() / 1000) - unix)
  if (sec < 60)  return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60)  return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 7)     return `${d}d ago`
  if (d < 30)    return `${Math.floor(d / 7)}w ago`
  if (d < 365)   return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

function fmtDuration(seconds: number): string {
  if (!seconds) return '0 mins'
  const d   = Math.floor(seconds / 86400)
  const hrs = Math.floor((seconds % 86400) / 3600)
  const min = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d   > 0) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`)
  if (hrs > 0) parts.push(`${hrs} hr${hrs > 1 ? 's' : ''}`)
  if (min > 0 || !parts.length) parts.push(`${min} min${min !== 1 ? 's' : ''}`)
  return parts.join(' ')
}

function fmtDurationCompact(seconds: number): string {
  if (!seconds) return '0m'
  const d   = Math.floor(seconds / 86400)
  const hrs = Math.floor((seconds % 86400) / 3600)
  const min = Math.floor((seconds % 3600) / 60)
  if (d   > 0) return `${d}d ${hrs}h ${min}m`
  if (hrs > 0) return `${hrs}h ${min}m`
  return `${min}m`
}

// Map Tautulli platform_type strings to brand colors + short labels.
const PLATFORM_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  android:     { bg: '#A4C639', fg: '#000', label: 'AND' },
  ios:         { bg: '#555',    fg: '#fff', label: 'iOS' },
  apple:       { bg: '#555',    fg: '#fff', label: 'ATV' },
  roku:        { bg: '#6F1AB1', fg: '#fff', label: 'ROKU' },
  xbox:        { bg: '#107C10', fg: '#fff', label: 'XBOX' },
  playstation: { bg: '#003087', fg: '#fff', label: 'PS' },
  chrome:      { bg: '#4285F4', fg: '#fff', label: 'CHR' },
  samsung:     { bg: '#1428A0', fg: '#fff', label: 'SAM' },
  opera:       { bg: '#FF1B2D', fg: '#fff', label: 'OPR' },
  windows:     { bg: '#0078D4', fg: '#fff', label: 'WIN' },
  default:     { bg: '#A0522D', fg: '#fff', label: '?' },
}

function platformStyle(pt: string) {
  const key = (pt || '').toLowerCase()
  for (const [k, v] of Object.entries(PLATFORM_STYLES)) {
    if (k !== 'default' && key.includes(k)) return v
  }
  return { ...PLATFORM_STYLES.default, label: key.slice(0, 4).toUpperCase() || '?' }
}

function tautulliImg(thumb: string, w = 150, h = 225) {
  if (!thumb) return ''
  return `/api/tautulli/image?img=${encodeURIComponent(thumb)}&width=${w}&height=${h}`
}

function UserAvatar({ thumb, name, size = 40, C }: {
  thumb: string; name: string; size?: number; C: ReturnType<typeof useC>
}) {
  const [err, setErr] = useState(false)
  const initial = (name || '?')[0].toUpperCase()
  const proxyableThumb = thumb.startsWith('/library/') || thumb.startsWith('/playlists/')
  if (proxyableThumb && !err) {
    return (
      <Box sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <AuthenticatedImage
          source={tautulliImg(thumb, size, size)}
          alt={name}
          width={size}
          height={size}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          onError={() => setErr(true)}
        />
      </Box>
    )
  }
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: C.rustBg, border: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.rust, fontWeight: 700, fontSize: size * 0.4,
    }}>
      {initial}
    </Box>
  )
}

// ── Users list ────────────────────────────────────────────────────────────
function UsersListView({ onSelect, C }: {
  onSelect: (user: TautulliUser) => void
  C: ReturnType<typeof useC>
}) {
  const [users, setUsers] = useState<TautulliUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await apiClient.fetch('/api/tautulli/users')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setUsers(d.users || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  if (loading) return (
    <Box sx={{ p: 5, textAlign: 'center' }}>
      <CircularProgress size={24} thickness={3} sx={{ color: C.rust }} />
      <Typography sx={{ mt: 1.5, fontSize: '0.82rem', color: C.muted }}>Loading users…</Typography>
    </Box>
  )
  if (error) return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography sx={{ color: C.red, fontSize: '0.88rem' }}>{error}</Typography>
    </Box>
  )

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.3rem', color: C.ink }}>
          All Users
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
            {users.filter(u => u.is_active).length} active
          </Typography>
          <Tooltip title="Refresh">
            <IconButton onClick={fetch_} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ bgcolor: C.paper, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
        {/* Header row */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.1fr 1.3fr 1fr 2fr 0.8fr 1.1fr',
          px: 2, py: 1, borderBottom: `1px solid ${C.border}`,
          bgcolor: C.surface,
        }}>
          {['User', 'Last Seen', 'Last IP', 'Platform', 'Last Played', 'Plays', 'Watch Time'].map(h => (
            <Typography key={h} sx={{
              fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted,
            }}>{h}</Typography>
          ))}
        </Box>

        {users.map((u, i) => (
          <Box
            key={u.user_id}
            onClick={() => onSelect(u)}
            sx={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.1fr 1.3fr 1fr 2fr 0.8fr 1.1fr',
              px: 2, py: 1.2,
              borderBottom: i < users.length - 1 ? `1px solid ${C.border}` : 'none',
              cursor: 'pointer', alignItems: 'center',
              '&:hover': { bgcolor: C.surface },
              transition: 'background-color 0.1s',
            }}
          >
            {/* User */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
              <UserAvatar thumb={u.thumb} name={u.friendly_name || u.username} size={32} C={C} />
              <Typography noWrap sx={{ fontSize: '0.88rem', fontWeight: 600, color: C.ink }}>
                {u.friendly_name || u.username}
              </Typography>
              {!u.is_active && (
                <Chip label="inactive" size="small" sx={{
                  height: 16, fontSize: '0.58rem', bgcolor: 'transparent',
                  border: `1px solid ${C.border}`, color: C.muted,
                }} />
              )}
            </Box>
            {/* Last Seen */}
            <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: u.last_seen ? C.ink : C.muted }}>
              {timeAgo(u.last_seen)}
            </Typography>
            {/* Last IP */}
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
              {u.last_ip || 'n/a'}
            </Typography>
            {/* Platform */}
            <Typography noWrap sx={{ fontSize: '0.78rem', color: C.muted }}>
              {u.last_platform || '—'}
            </Typography>
            {/* Last Played */}
            <Typography noWrap sx={{ fontSize: '0.8rem', color: C.ink }}>
              {u.last_played || '—'}
            </Typography>
            {/* Plays */}
            <Typography sx={{ fontFamily: MONO, fontSize: '0.82rem', color: C.rust, fontWeight: 600 }}>
              {(u.plays || 0).toLocaleString()}
            </Typography>
            {/* Watch Time */}
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
              {u.duration ? fmtDuration(u.duration) : '—'}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── User detail ───────────────────────────────────────────────────────────
type DetailTab = 'profile' | 'history'

function UserDetailView({ user, onBack, C }: {
  user: TautulliUser
  onBack: () => void
  C: ReturnType<typeof useC>
}) {
  const [tab, setTab] = useState<DetailTab>('profile')
  const [profileData, setProfileData] = useState<{
    watchStats: WatchTimeStat[]
    playerStats: PlayerStat[]
    recentlyWatched: HistoryRow[]
  } | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyLoaded = useRef(false)

  // Load profile on mount
  useEffect(() => {
    setProfileLoading(true)
    apiClient.fetch(`/api/tautulli/users/${user.user_id}`)
      .then(r => r.json())
      .then(d => setProfileData({
        watchStats:      d.watchStats || [],
        playerStats:     d.playerStats || [],
        recentlyWatched: d.recentlyWatched || [],
      }))
      .catch(() => setProfileData({ watchStats: [], playerStats: [], recentlyWatched: [] }))
      .finally(() => setProfileLoading(false))
  }, [user.user_id])

  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    try {
      const r = await apiClient.fetch(`/api/tautulli/users/${user.user_id}/history?page=${page}&length=25`)
      if (!r.ok) throw new Error()
      const d = await r.json()
      setHistoryRows(d.rows || [])
      setHistoryTotal(d.total || 0)
    } finally {
      setHistoryLoading(false)
    }
  }, [user.user_id])

  useEffect(() => {
    if (tab === 'history' && !historyLoaded.current) {
      historyLoaded.current = true
      fetchHistory(1)
    }
  }, [tab, fetchHistory])

  useEffect(() => {
    if (historyLoaded.current) fetchHistory(historyPage)
  }, [historyPage, fetchHistory])

  const totalHistoryPages = Math.ceil(historyTotal / 25)

  return (
    <Box>
      {/* Back button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={onBack} size="small"
          sx={{ color: C.muted, border: `1px solid ${C.border}`, borderRadius: '8px', '&:hover': { color: C.rust, borderColor: C.rust } }}>
          <BackIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>All Users</Typography>
        <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>/</Typography>
        <Typography sx={{ fontSize: '0.82rem', color: C.ink, fontWeight: 600 }}>
          {user.friendly_name || user.username}
        </Typography>
      </Box>

      {/* Header card */}
      <Box sx={{
        bgcolor: C.paper, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS,
        p: 3, mb: 3,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
          <UserAvatar thumb={user.thumb} name={user.friendly_name || user.username} size={56} C={C} />
          <Box>
            <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.5rem', color: C.ink, lineHeight: 1.2 }}>
              {user.friendly_name || user.username}
            </Typography>
            {user.friendly_name && user.username !== user.friendly_name && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
                @{user.username}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Sub-tabs */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {([
            { key: 'profile', label: 'Profile', icon: <PersonIcon sx={{ fontSize: 15 }} /> },
            { key: 'history', label: 'History', icon: <HistoryIcon sx={{ fontSize: 15 }} /> },
          ] as { key: DetailTab; label: string; icon: React.ReactNode }[]).map(t => (
            <Box
              key={t.key}
              onClick={() => setTab(t.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.6,
                px: 1.5, py: 0.6, borderRadius: '8px', cursor: 'pointer',
                bgcolor: tab === t.key ? C.rustBg : 'transparent',
                color: tab === t.key ? C.rust : C.muted,
                fontWeight: tab === t.key ? 600 : 400,
                fontSize: '0.82rem',
                '&:hover': { bgcolor: C.rustBg, color: C.rust },
              }}
            >
              {t.icon}{t.label}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Profile tab */}
      {tab === 'profile' && (
        profileLoading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={24} thickness={3} sx={{ color: C.rust }} />
          </Box>
        ) : profileData ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Global Stats */}
            <SectionCard label="Global Stats" C={C}>
              {profileData.watchStats.length === 0 ? (
                <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>No watch stats available.</Typography>
              ) : (
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                  gap: 2,
                }}>
                  {profileData.watchStats.map((ws) => {
                    const label = ws.query_days === 1 ? 'Last 24 hours'
                      : ws.query_days === 7  ? 'Last 7 days'
                      : ws.query_days === 30 ? 'Last 30 days'
                      : 'All Time'
                    return (
                      <Box key={ws.query_days} sx={{
                        bgcolor: C.surface, borderRadius: CARD_RADIUS, p: 2,
                        border: ws.query_days === 0 ? `1px solid ${C.rust}44` : `1px solid ${C.border}`,
                      }}>
                        <Typography sx={{
                          fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700,
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          color: ws.query_days === 0 ? C.rust : C.muted, mb: 1,
                        }}>
                          {label}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flexWrap: 'wrap' }}>
                          <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.6rem', color: C.rust, lineHeight: 1 }}>
                            {ws.total_plays.toLocaleString()}
                          </Typography>
                          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.muted }}>plays</Typography>
                          <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted, ml: 0.5 }}>/</Typography>
                          <Typography sx={{ fontFamily: MONO, fontSize: '0.82rem', color: C.ink, fontWeight: 600 }}>
                            {fmtDurationCompact(ws.total_time)}
                          </Typography>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              )}
            </SectionCard>

            {/* Player Stats */}
            {profileData.playerStats.length > 0 && (
              <SectionCard label="Player Stats" icon={<DevicesIcon sx={{ fontSize: 16 }} />} C={C}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                  {profileData.playerStats.map((ps, i) => {
                    const ps_ = platformStyle(ps.platform_type || ps.platform)
                    return (
                      <Box key={i} sx={{
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        bgcolor: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: CARD_RADIUS, px: 2, py: 1.5,
                      }}>
                        {/* Platform icon */}
                        <Box sx={{
                          width: 40, height: 40, borderRadius: '8px',
                          bgcolor: ps_.bg, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Typography sx={{
                            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700,
                            color: ps_.fg, letterSpacing: '0.02em',
                          }}>{ps_.label}</Typography>
                        </Box>
                        <Box>
                          <Typography noWrap sx={{ fontSize: '0.85rem', fontWeight: 600, color: C.ink, maxWidth: 140 }}>
                            {ps.player}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                            <Typography sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.2rem', color: C.rust, lineHeight: 1.1 }}>
                              {ps.total_plays.toLocaleString()}
                            </Typography>
                            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.muted }}>plays</Typography>
                          </Box>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </SectionCard>
            )}

            {/* Recently Played */}
            {profileData.recentlyWatched.length > 0 && (
              <SectionCard label="Recently Played" icon={<HistoryIcon sx={{ fontSize: 16 }} />} C={C}>
                <Box sx={{
                  display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1,
                  '&::-webkit-scrollbar': { height: 5 },
                  '&::-webkit-scrollbar-track': { background: 'transparent' },
                  '&::-webkit-scrollbar-thumb': { background: C.border, borderRadius: 2 },
                }}>
                  {profileData.recentlyWatched.map((rw, i) => {
                    const title = rw.grandparent_title
                      ? `${rw.grandparent_title}: ${rw.title}`
                      : rw.title || '—'
                    return (
                      <Box key={i} sx={{ flexShrink: 0, width: 100 }}>
                        <Box sx={{
                          width: 100, height: 150, borderRadius: '8px', overflow: 'hidden',
                          bgcolor: C.surface, border: `1px solid ${C.border}`, mb: 0.8,
                          position: 'relative',
                        }}>
                          {rw.thumb ? (
                            <AuthenticatedImage
                              source={tautulliImg(rw.thumb, 100, 150)}
                              alt={title}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                              <PersonIcon sx={{ color: C.muted, fontSize: 30 }} />
                            </Box>
                          )}
                        </Box>
                        <Typography noWrap sx={{ fontSize: '0.7rem', color: C.ink, fontWeight: 600 }}>
                          {rw.grandparent_title || rw.title || '—'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.65rem', color: C.muted }}>
                          {timeAgo(rw.date)}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              </SectionCard>
            )}
          </Box>
        ) : null
      )}

      {/* History tab */}
      {tab === 'history' && (
        <Box>
          <Box sx={{ bgcolor: C.paper, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
            {/* Table header */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '2.5fr 1fr 1.2fr 1fr 0.9fr',
              px: 2, py: 1, borderBottom: `1px solid ${C.border}`,
              bgcolor: C.surface,
            }}>
              {['Title', 'Date', 'Platform / Player', 'Duration', 'Watched'].map(h => (
                <Typography key={h} sx={{
                  fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted,
                }}>{h}</Typography>
              ))}
            </Box>

            {historyLoading && historyRows.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress size={20} thickness={3} sx={{ color: C.rust }} />
              </Box>
            ) : historyRows.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.82rem', color: C.muted }}>No history found.</Typography>
              </Box>
            ) : historyRows.map((row, i) => {
              const title = row.grandparent_title
                ? `${row.grandparent_title} › ${row.title}`
                : row.title || '—'
              return (
                <Box key={i} sx={{
                  display: 'grid',
                  gridTemplateColumns: '2.5fr 1fr 1.2fr 1fr 0.9fr',
                  px: 2, py: 1.1,
                  borderBottom: i < historyRows.length - 1 ? `1px solid ${C.border}` : 'none',
                  alignItems: 'center',
                  '&:hover': { bgcolor: C.surface },
                }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.83rem', color: C.ink, fontWeight: 500 }}>{title}</Typography>
                    {row.media_type && (
                      <Typography sx={{ fontSize: '0.68rem', color: C.muted, textTransform: 'capitalize' }}>
                        {row.media_type}
                      </Typography>
                    )}
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
                    {timeAgo(row.date)}
                  </Typography>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.72rem', color: C.muted }}>
                      {row.platform} · {row.player}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.muted }}>
                    {fmtDurationCompact(row.duration)}
                  </Typography>
                  <Box>
                    <Chip
                      label={row.watched_status >= 1 ? 'Watched' : 'Partial'}
                      size="small"
                      sx={{
                        height: 18, fontSize: '0.62rem', fontWeight: 600,
                        bgcolor: row.watched_status >= 1
                          ? C.green + '22'
                          : C.amber + '22',
                        color: row.watched_status >= 1 ? C.green : C.amber,
                        border: `1px solid ${row.watched_status >= 1 ? C.green + '55' : C.amber + '55'}`,
                      }}
                    />
                  </Box>
                </Box>
              )
            })}
          </Box>

          {/* Pagination */}
          {totalHistoryPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.5, mt: 2 }}>
              <IconButton onClick={() => setHistoryPage(1)} disabled={historyPage <= 1} size="small"
                sx={{ color: C.muted }}>
                <PrevIcon sx={{ fontSize: 18 }} /><PrevIcon sx={{ fontSize: 18, ml: -1 }} />
              </IconButton>
              <IconButton onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} size="small"
                sx={{ color: C.muted }}>
                <PrevIcon sx={{ fontSize: 20 }} />
              </IconButton>
              {Array.from({ length: Math.min(5, totalHistoryPages) }, (_, k) => {
                const start = Math.max(1, Math.min(historyPage - 2, totalHistoryPages - 4))
                const p = start + k
                return (
                  <Box key={p} onClick={() => setHistoryPage(p)} sx={{
                    width: 28, height: 28, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '0.78rem',
                    bgcolor: historyPage === p ? C.rustBg : 'transparent',
                    color:   historyPage === p ? C.rust : C.muted,
                    border:  `1px solid ${historyPage === p ? C.rust + '55' : 'transparent'}`,
                  }}>{p}</Box>
                )
              })}
              <IconButton onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} size="small"
                sx={{ color: C.muted }}>
                <NextIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <IconButton onClick={() => setHistoryPage(totalHistoryPages)} disabled={historyPage >= totalHistoryPages} size="small"
                sx={{ color: C.muted }}>
                <NextIcon sx={{ fontSize: 18 }} /><NextIcon sx={{ fontSize: 18, ml: -1 }} />
              </IconButton>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────
function SectionCard({ label, icon, children, C }: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
  C: ReturnType<typeof useC>
}) {
  return (
    <Box sx={{ bgcolor: C.paper, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
      <Box sx={{
        px: 2.5, py: 1.5, borderBottom: `1px solid ${C.border}`,
        bgcolor: C.surface, display: 'flex', alignItems: 'center', gap: 1,
      }}>
        {icon && <Box sx={{ color: C.rust }}>{icon}</Box>}
        <Typography sx={{
          fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
          letterSpacing: '0.15em', textTransform: 'uppercase', color: C.rust,
        }}>
          // {label}
        </Typography>
      </Box>
      <Box sx={{ p: 2.5 }}>{children}</Box>
    </Box>
  )
}

// ── Main export ───────────────────────────────────────────────────────────
export default function PlexUsers() {
  const C = useC()
  const [selectedUser, setSelectedUser] = useState<TautulliUser | null>(null)

  return (
    <Box>
      {selectedUser ? (
        <UserDetailView
          user={selectedUser}
          onBack={() => setSelectedUser(null)}
          C={C}
        />
      ) : (
        <UsersListView onSelect={setSelectedUser} C={C} />
      )}
    </Box>
  )
}
