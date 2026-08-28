import type { HearthTokens } from '../../theme/tokens';
import type { Paged } from './types';

export type SonarrTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export const toneColor = (tone: SonarrTone, isDark: boolean, t: HearthTokens): string => {
  if (tone === 'good') return isDark ? '#65C98B' : '#287A4A';
  if (tone === 'warn') return isDark ? '#E6B45F' : '#936315';
  if (tone === 'bad') return isDark ? '#F07B72' : '#B94339';
  if (tone === 'info') return isDark ? '#69B9DD' : '#197A9F';
  return t.muted;
};

export function recordsOf<T>(value: T[] | Paged<T> | undefined): T[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.records) ? value.records : [];
}

export function fmtNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString();
}

export function fmtBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1e12) return `${(value / 1e12).toFixed(value >= 10e12 ? 1 : 2)} TB`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB`;
  return `${Math.round(value)} B`;
}

export function fmtDate(value: string | number | null | undefined, includeTime = false): string {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }
  ).format(date);
}

export function fmtRelative(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const delta = timestamp - Date.now();
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (absolute < 90 * 60_000) return formatter.format(Math.round(delta / 60_000), 'minute');
  if (absolute < 36 * 3600_000) return formatter.format(Math.round(delta / 3600_000), 'hour');
  return formatter.format(Math.round(delta / 86400_000), 'day');
}

export function episodeCode(episode: { seasonNumber?: number; episodeNumber?: number }): string {
  if (episode.seasonNumber == null || episode.episodeNumber == null) return 'Episode';
  return `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
