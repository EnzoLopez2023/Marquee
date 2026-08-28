import { apiClient } from './services/apiClient'
/*
THESIS: A production run sheet makes the TV pipeline legible end to end instead of opening on a generic metric-card grid.
OWN-WORLD: Marquee's paper surfaces, quiet sky palette, compact ruled tables, and semantic status colors carry the whole page.
STORY: See whether acquisition is flowing, isolate the stage with friction, then move into library, activity, report, or system detail.
FIRST VIEWPORT: The title and live source state lead directly into one segmented Wanted-to-On-disk pipeline, with triage below.
FORM: Candidate seven, production run sheet; familiar rooms below the persistent pipeline; surface seed 61df4e16.
*/
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  ArrowForward as ArrowIcon,
  CheckCircleOutline as CompleteIcon,
  CloudDownload as QueueIcon,
  Download as DownloadIcon,
  ErrorOutline as ErrorIcon,
  LibraryAddCheck as LibraryIcon,
  MoveToInbox as ImportIcon,
  Refresh as RefreshIcon,
  Search as WantedIcon,
} from './components/AppIcons'
import PageHero from './components/PageHero';
import { useThemeMode } from './context/ThemeContext';
import { tokensFor } from './theme/tokens';
import { accentHover, onAccent, pageShellSx, toggleGroupSx } from './theme/controls';
import { withAlpha } from './theme/contrast';
import SonarrOverview from './components/sonarr/SonarrOverview';
import SonarrLibrary from './components/sonarr/SonarrLibrary';
import SonarrActivity from './components/sonarr/SonarrActivity';
import SonarrReports from './components/sonarr/SonarrReports';
import SonarrSystem from './components/sonarr/SonarrSystem';
import type {
  SonarrDashboardResponse,
  SonarrSnapshot,
  SonarrTrendPoint,
} from './components/sonarr/types';
import {
  Panel,
  StatusChip,
} from './components/sonarr/sonarrUi';
import { downloadFile, fmtNumber, fmtRelative, toneColor } from './components/sonarr/sonarrFormat';

type Tab = 'overview' | 'library' | 'activity' | 'reports' | 'system';

interface TrendsResponse {
  ok: boolean;
  points?: SonarrTrendPoint[];
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export default function SonarrDashboard() {
  const { mode, palette } = useThemeMode();
  const isDark = mode === 'dark';
  const t = tokensFor(isDark, palette);
  const [tab, setTab] = useState<Tab>('overview');
  const [response, setResponse] = useState<SonarrDashboardResponse | null>(null);
  const [trends, setTrends] = useState<SonarrTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const dashboardResponse = await apiClient.fetch('/api/sonarr/dashboard', { cache: 'no-store' });
      const dashboard = await readJson<SonarrDashboardResponse>(dashboardResponse);
      setResponse(dashboard);

      try {
        const trendResponse = await apiClient.fetch('/api/sonarr/trends?days=365', { cache: 'no-store' });
        const trendBody = await readJson<TrendsResponse>(trendResponse);
        setTrends(Array.isArray(trendBody.points) ? trendBody.points : []);
      } catch {
        setTrends([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Sonarr data could not be loaded');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 120_000);
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const snapshot = response?.snapshot;
  const metrics = snapshot?.insights.metrics;
  const pipeline = snapshot?.insights.pipeline;
  const accent = isDark ? t.rustLight : t.rustDark;
  const stageColors = useMemo(() => ({
    wanted: toneColor(metrics?.missingCount ? 'warn' : 'good', isDark, t),
    grabbed: toneColor('info', isDark, t),
    queue: toneColor(metrics?.queueCount ? 'info' : 'neutral', isDark, t),
    imported: toneColor('good', isDark, t),
    library: accent,
  }), [accent, isDark, metrics?.missingCount, metrics?.queueCount, t]);

  const exportSnapshot = async () => {
    setExporting(true);
    try {
      const exportResponse = await apiClient.fetch('/api/sonarr/export', { cache: 'no-store' });
      const body = await readJson<{ snapshot: SonarrSnapshot }>(exportResponse);
      downloadFile(
        `sonarr-complete-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(body.snapshot, null, 2),
        'application/json',
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'The Sonarr export failed');
    } finally {
      setExporting(false);
    }
  };

  const heroActions = snapshot ? (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={refreshing ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <RefreshIcon />}
        onClick={() => void load(true)}
        disabled={refreshing}
        sx={{ color: t.ink, borderColor: t.line, bgcolor: withAlpha(t.paper, 0.88), textTransform: 'none', fontWeight: 750 }}
      >
        Refresh
      </Button>
      <Button
        variant="contained"
        size="small"
        startIcon={exporting ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <DownloadIcon />}
        onClick={() => void exportSnapshot()}
        disabled={exporting}
        sx={{
          color: onAccent(accent),
          bgcolor: accent,
          textTransform: 'none',
          fontWeight: 800,
          '&:hover': { bgcolor: accentHover(accent, isDark) },
        }}
      >
        Complete JSON
      </Button>
    </>
  ) : undefined;

  return (
    <Box sx={pageShellSx(true)}>
      <PageHero
        compact
        eyebrow="Sonarr · nordtorrent"
        title="The TV pipeline, end to end"
        accentPhrase="end to end"
        subtitle="Read-only acquisition intelligence across wanted episodes, downloads, imports, library quality, storage, logs, and Sonarr itself."
        actions={heroActions}
      />

      {loading && !response && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Panel t={t} sx={{ p: 2 }}>
            <Skeleton variant="text" width="28%" height={28} sx={{ bgcolor: t.surface }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1, mt: 1.5 }}>
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} variant="rounded" height={96} sx={{ bgcolor: t.surface }} />)}
            </Box>
          </Panel>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 2 }}>
            <Skeleton variant="rounded" height={340} sx={{ bgcolor: t.surface }} />
            <Skeleton variant="rounded" height={340} sx={{ bgcolor: t.surface }} />
          </Box>
        </Box>
      )}

      {error && !response?.present && (
        <Panel t={t} sx={{ p: { xs: 2, md: 3 }, textAlign: 'center' }}>
          <ErrorIcon sx={{ color: toneColor('bad', isDark, t), fontSize: 34 }} />
          <Typography component="h2" sx={{ color: t.ink, fontSize: '1rem', fontWeight: 800, mt: 1 }}>
            Marquee could not read the Sonarr snapshot
          </Typography>
          <Typography sx={{ color: t.muted, fontSize: '0.78rem', mt: 0.5 }}>{error}</Typography>
          <Button variant="outlined" onClick={() => void load()} sx={{ mt: 2, color: t.ink, borderColor: t.line, textTransform: 'none' }}>Try again</Button>
        </Panel>
      )}

      {!loading && response && !response.present && (
        <Panel t={t} sx={{ p: { xs: 2, md: 3 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(360px, 0.85fr)' }, gap: 3, alignItems: 'start' }}>
            <Box>
              <Typography component="h2" sx={{ color: t.ink, fontSize: '1.15rem', fontWeight: 850 }}>Ready for the first Sonarr snapshot</Typography>
              <Typography sx={{ color: t.inkSoft, fontSize: '0.82rem', lineHeight: 1.6, mt: 0.75, maxWidth: 620 }}>
                Azure cannot reach the private Sonarr address directly. The included on-site agent reads Sonarr from nordtorrent and sends only sanitized, compressed data outbound to Marquee.
              </Typography>
            </Box>
            <Box sx={{ display: 'grid', borderTop: `1px solid ${t.line}` }}>
              {[
                ['1', 'Set SONARR_INGEST_TOKEN in Marquee through Key Vault.'],
                ['2', 'Copy scripts/sonarr-agent to nordtorrent.'],
                ['3', 'Run install-task.ps1 with the Marquee URL, ingest token, Sonarr URL, and API key.'],
              ].map(([number, instruction]) => (
                <Box key={number} sx={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 1, py: 0.85, borderBottom: `1px solid ${t.line}` }}>
                  <Typography sx={{ color: accent, fontSize: '0.72rem', fontWeight: 850 }}>{number}</Typography>
                  <Typography sx={{ color: t.ink, fontSize: '0.75rem' }}>{instruction}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Panel>
      )}

      {snapshot && metrics && pipeline && (
        <>
          {(response?.stale || error) && (
            <Box
              role="status"
              sx={{
                mb: 2,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                bgcolor: `${toneColor('warn', isDark, t)}16`,
                border: `1px solid ${toneColor('warn', isDark, t)}55`,
                display: 'flex',
                gap: 1,
                alignItems: 'center',
              }}
            >
              <ErrorIcon sx={{ color: toneColor('warn', isDark, t), fontSize: 19 }} />
              <Typography sx={{ color: t.ink, fontSize: '0.75rem' }}>
                {response.stale
                  ? `The last Sonarr snapshot arrived ${fmtRelative(response.received_at)}. Values remain visible but are not current.`
                  : `Refresh failed: ${error}`}
              </Typography>
            </Box>
          )}

          <Panel t={t} sx={{ mb: 2, overflow: 'hidden' }}>
            <Box sx={{ px: { xs: 1.5, md: 2 }, pt: 1.5, pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
                <Box>
                  <Typography component="h2" sx={{ color: t.ink, fontSize: '0.92rem', fontWeight: 850 }}>Acquisition run sheet</Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.7rem', mt: 0.2 }}>
                    Current backlog and queue, with 24-hour event counts. Snapshot {fmtRelative(snapshot.sampled_at)}.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center' }}>
                  <StatusChip label={response.stale ? 'stale' : metrics.healthIssueCount ? `${metrics.healthIssueCount} health issue${metrics.healthIssueCount === 1 ? '' : 's'}` : 'healthy'} tone={response.stale ? 'warn' : metrics.healthIssueCount ? 'bad' : 'good'} t={t} isDark={isDark} />
                  <StatusChip label={`${snapshot.insights.collection.healthyEndpointCount}/${snapshot.insights.collection.endpointCount} sources`} tone={snapshot.insights.collection.failedEndpointCount ? 'warn' : 'good'} t={t} isDark={isDark} />
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', overflowX: 'auto', borderTop: `1px solid ${t.line}`, scrollbarWidth: 'thin' }}>
              {[
                { key: 'wanted', label: 'Wanted', value: pipeline.wanted, detail: 'missing now', icon: <WantedIcon />, color: stageColors.wanted },
                { key: 'grabbed', label: 'Grabbed', value: pipeline.grabbed24h, detail: 'last 24 hours', icon: <QueueIcon />, color: stageColors.grabbed },
                { key: 'queue', label: 'Active queue', value: pipeline.queued, detail: 'downloading / importing', icon: <ImportIcon />, color: stageColors.queue },
                { key: 'imported', label: 'Imported', value: pipeline.imported24h, detail: 'last 24 hours', icon: <CompleteIcon />, color: stageColors.imported },
                { key: 'library', label: 'On disk', value: pipeline.availableEpisodes, detail: fmtNumber(metrics.seriesCount) + ' series', icon: <LibraryIcon />, color: stageColors.library },
              ].map((stage, index) => (
                <Box key={stage.key} sx={{ display: 'contents' }}>
                  {index > 0 && (
                    <Box sx={{ width: 30, flex: '0 0 30px', display: 'grid', placeItems: 'center', color: t.muted, borderLeft: `1px solid ${t.line}` }}>
                      <ArrowIcon sx={{ fontSize: 16 }} />
                    </Box>
                  )}
                  <Box sx={{ minWidth: 160, flex: '1 0 160px', p: 1.4 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Box sx={{ color: stage.color, '& svg': { fontSize: 20 } }}>{stage.icon}</Box>
                      <Typography sx={{ color: t.muted, fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{stage.label}</Typography>
                    </Box>
                    <Typography sx={{ color: t.ink, fontSize: '1.35rem', lineHeight: 1.15, fontWeight: 850, mt: 0.65 }}>{fmtNumber(stage.value)}</Typography>
                    <Typography sx={{ color: t.muted, fontSize: '0.65rem', mt: 0.2 }}>{stage.detail}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            {pipeline.failed24h > 0 && (
              <Box sx={{ px: 2, py: 0.75, borderTop: `1px solid ${t.line}`, bgcolor: `${toneColor('bad', isDark, t)}12` }}>
                <Typography sx={{ color: toneColor('bad', isDark, t), fontSize: '0.7rem', fontWeight: 700 }}>
                  {fmtNumber(pipeline.failed24h)} failed download event{pipeline.failed24h === 1 ? '' : 's'} in the last 24 hours
                </Typography>
              </Box>
            )}
          </Panel>

          <Box sx={{ mb: 2, overflowX: 'auto', pb: 0.25 }}>
            <ToggleButtonGroup
              exclusive
              value={tab}
              onChange={(_event, next: Tab | null) => next && setTab(next)}
              aria-label="Sonarr dashboard section"
              sx={{ ...toggleGroupSx(t), minWidth: 'max-content' }}
            >
              <ToggleButton value="overview">Overview</ToggleButton>
              <ToggleButton value="library">Library</ToggleButton>
              <ToggleButton value="activity">Activity & logs</ToggleButton>
              <ToggleButton value="reports">Reports</ToggleButton>
              <ToggleButton value="system">System & API</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {tab === 'overview' && <SonarrOverview data={snapshot.data} insights={snapshot.insights} trends={trends} t={t} isDark={isDark} />}
          {tab === 'library' && <SonarrLibrary data={snapshot.data} insights={snapshot.insights} t={t} isDark={isDark} />}
          {tab === 'activity' && <SonarrActivity data={snapshot.data} insights={snapshot.insights} t={t} isDark={isDark} />}
          {tab === 'reports' && <SonarrReports data={snapshot.data} insights={snapshot.insights} trends={trends} t={t} isDark={isDark} />}
          {tab === 'system' && <SonarrSystem snapshot={snapshot} data={snapshot.data} t={t} isDark={isDark} />}
        </>
      )}
    </Box>
  );
}
