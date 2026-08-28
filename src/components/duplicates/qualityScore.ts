// Quality scoring helpers. The server in routes/plex-duplicates.js scores each
// copy at scan time and ships the score + reasons in the API response, so the
// UI normally just reads `copy.qualityScore` and `copy.qualityReasons`. These
// helpers exist for two reasons:
//
//   1. Unit-testable, deterministic shape that mirrors the server formula
//      (kept in sync intentionally — if you change one, change the other).
//   2. Useful as utilities for formatting / labelling in the UI.

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '—'
  const totalMinutes = Math.round(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatTimestamp(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleString()
}

export function formatTimestampMs(unixMs: number | null | undefined): string {
  if (!unixMs) return '—'
  const d = new Date(unixMs)
  return d.toLocaleString()
}

export function timeAgo(unixMs: number | null | undefined): string {
  if (!unixMs) return '—'
  const diff = Date.now() - unixMs
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

export function resolutionLabel(res: string | null): string {
  if (!res) return 'unknown'
  const lc = res.toLowerCase()
  if (lc === '4k')   return '4K'
  if (lc === '1080') return '1080p'
  if (lc === '720')  return '720p'
  if (lc === '480' || lc === 'sd') return 'SD'
  return res
}
