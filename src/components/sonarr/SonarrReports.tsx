import { Box, Button, LinearProgress, Typography } from '@mui/material';
import {
  Download as DownloadIcon,
  FolderOff as FolderOffIcon,
  Inventory2 as InventoryIcon,
  ReportProblem as ReportIcon,
  Storage as StorageIcon,
} from '../../components/AppIcons'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HearthTokens } from '../../theme/tokens';
import type { SonarrData, SonarrInsights, SonarrTrendPoint } from './types';
import {
  EmptyState,
  Panel,
  SectionTitle,
  StatusChip,
} from './sonarrUi';
import { csvCell, downloadFile, fmtBytes, fmtDate, fmtNumber, recordsOf, toneColor } from './sonarrFormat';

interface Props {
  data: SonarrData;
  insights: SonarrInsights;
  trends: SonarrTrendPoint[];
  t: HearthTokens;
  isDark: boolean;
}

export default function SonarrReports({ data, insights, trends, t, isDark }: Props) {
  const series = recordsOf(data.series);
  const roots = recordsOf(data.rootFolders);
  const disks = recordsOf(data.diskSpace);
  const unmonitored = series.filter((item) => !item.monitored);
  const emptySeries = series.filter((item) => (Number(item.statistics?.episodeFileCount) || 0) === 0);
  const inaccessibleRoots = roots.filter((root) => root.accessible === false);
  const lowDisks = disks.filter((disk) => {
    const total = Number(disk.totalSpace) || 0;
    return total > 0 && (Number(disk.freeSpace) || 0) / total < 0.15;
  });

  const chartStyle = {
    backgroundColor: t.paper,
    border: `1px solid ${t.line}`,
    borderRadius: 10,
    color: t.ink,
    fontSize: 12,
  };
  const trendData = trends.map((point) => ({
    ...point,
    label: fmtDate(point.sampled_at),
    libraryTB: point.library_size_bytes == null ? null : Number((point.library_size_bytes / 1e12).toFixed(2)),
    freeTB: point.free_space_bytes == null ? null : Number((point.free_space_bytes / 1e12).toFixed(2)),
  }));

  const exportSeries = () => {
    const header = ['Title', 'Year', 'Network', 'Status', 'Monitored', 'Episodes', 'Files', 'Coverage %', 'Size bytes', 'Path'];
    const rows = series.map((item) => [
      item.title,
      item.year,
      item.network,
      item.status,
      item.monitored,
      item.statistics?.episodeCount,
      item.statistics?.episodeFileCount,
      item.statistics?.percentOfEpisodes,
      item.statistics?.sizeOnDisk,
      item.path,
    ]);
    downloadFile(
      `sonarr-series-report-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const findings = [
    {
      key: 'missing',
      label: 'Missing monitored episodes',
      value: insights.metrics.missingCount,
      detail: 'Episodes Sonarr expects but cannot currently supply to Plex.',
      tone: insights.metrics.missingCount > 0 ? 'warn' as const : 'good' as const,
      icon: <ReportIcon />,
    },
    {
      key: 'cutoff',
      label: 'Below quality cutoff',
      value: insights.metrics.cutoffUnmetCount,
      detail: 'Existing files that remain eligible for a quality upgrade.',
      tone: insights.metrics.cutoffUnmetCount > 0 ? 'info' as const : 'good' as const,
      icon: <InventoryIcon />,
    },
    {
      key: 'unmonitored',
      label: 'Unmonitored series',
      value: unmonitored.length,
      detail: 'Series retained in the library but excluded from automatic acquisition.',
      tone: unmonitored.length > 0 ? 'neutral' as const : 'good' as const,
      icon: <FolderOffIcon />,
    },
    {
      key: 'empty',
      label: 'Series with no files',
      value: emptySeries.length,
      detail: 'Catalog entries whose statistics report zero episode files.',
      tone: emptySeries.length > 0 ? 'warn' as const : 'good' as const,
      icon: <StorageIcon />,
    },
  ];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle
          title="Library findings"
          detail="A concise quality and coverage report derived from the full Sonarr catalog."
          action={(
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={exportSeries}
              sx={{ color: t.ink, borderColor: t.line, textTransform: 'none', fontWeight: 700 }}
            >
              Series CSV
            </Button>
          )}
          t={t}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, borderTop: `1px solid ${t.line}`, borderLeft: `1px solid ${t.line}` }}>
          {findings.map((finding) => {
            const color = toneColor(finding.tone, isDark, t);
            return (
              <Box key={finding.key} sx={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: 1.1, p: 1.5, borderRight: `1px solid ${t.line}`, borderBottom: `1px solid ${t.line}` }}>
                <Box sx={{ color, mt: 0.2 }}>{finding.icon}</Box>
                <Box>
                  <Typography sx={{ color: t.ink, fontSize: '1.2rem', fontWeight: 850, lineHeight: 1.1 }}>{fmtNumber(finding.value)}</Typography>
                  <Typography sx={{ color: t.inkSoft, fontSize: '0.72rem', fontWeight: 700, mt: 0.35 }}>{finding.label}</Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.66rem', lineHeight: 1.4, mt: 0.25 }}>{finding.detail}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Panel>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle title="Quality debt over time" detail="Missing and below-cutoff counts captured by Marquee." t={t} />
          {trendData.length < 2 ? (
            <EmptyState title="Trend is collecting" detail="A second metric sample will unlock this chart. Samples are retained for one year." t={t} />
          ) : (
            <Box sx={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={34} />
                  <YAxis tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip contentStyle={chartStyle} />
                  <Legend wrapperStyle={{ color: t.muted, fontSize: 11 }} />
                  <Line type="monotone" dataKey="missing_count" name="Missing" stroke={toneColor('warn', isDark, t)} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cutoff_unmet_count" name="Below cutoff" stroke={toneColor('info', isDark, t)} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle title="Capacity history" detail="Library footprint and aggregate free space in terabytes." t={t} />
          {trendData.length < 2 ? (
            <EmptyState title="Trend is collecting" detail="Capacity history appears after the next metric sample." t={t} />
          ) : (
            <Box sx={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sonarrCapacity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={isDark ? t.rustLight : t.rustDark} stopOpacity={0.34} />
                      <stop offset="100%" stopColor={isDark ? t.rustLight : t.rustDark} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={34} />
                  <YAxis tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} unit=" TB" />
                  <ChartTooltip contentStyle={chartStyle} />
                  <Legend wrapperStyle={{ color: t.muted, fontSize: 11 }} />
                  <Area type="monotone" dataKey="libraryTB" name="Library" stroke={isDark ? t.rustLight : t.rustDark} fill="url(#sonarrCapacity)" strokeWidth={2} />
                  <Line type="monotone" dataKey="freeTB" name="Free space" stroke={toneColor('good', isDark, t)} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Panel>
      </Box>

      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle
          title="Storage report"
          detail="Root-folder accessibility and free space reported by Sonarr's host."
          t={t}
        />
        {roots.length === 0 && disks.length === 0 ? (
          <EmptyState title="No storage data" detail="Sonarr did not return any root folders or disk-space records." t={t} />
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {roots.map((root, index) => {
              const matchingDisk = disks.find((disk) => root.path?.startsWith(disk.path ?? '__no_match__'));
              const total = Number(matchingDisk?.totalSpace) || 0;
              const free = Number(root.freeSpace ?? matchingDisk?.freeSpace) || 0;
              const usedPct = total > 0 ? Math.max(0, Math.min(100, ((total - free) / total) * 100)) : 0;
              const low = total > 0 && free / total < 0.15;
              return (
                <Box key={root.id ?? root.path ?? index} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 0.8fr) minmax(260px, 1fr) auto' }, gap: { xs: 0.8, md: 2 }, alignItems: 'center', py: 1, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: t.ink, fontSize: '0.78rem', fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{root.path || 'Root folder'}</Typography>
                    <Typography sx={{ color: t.muted, fontSize: '0.66rem' }}>{fmtNumber(root.unmappedFolders?.length ?? 0)} unmapped folder{root.unmappedFolders?.length === 1 ? '' : 's'}</Typography>
                  </Box>
                  <Box>
                    <LinearProgress
                      variant="determinate"
                      value={usedPct}
                      sx={{ height: 7, borderRadius: 8, bgcolor: t.surface, '& .MuiLinearProgress-bar': { borderRadius: 8, bgcolor: low ? toneColor('bad', isDark, t) : toneColor('good', isDark, t) } }}
                    />
                    <Typography sx={{ color: t.muted, fontSize: '0.66rem', mt: 0.4 }}>
                      {fmtBytes(free)} free{total ? ` of ${fmtBytes(total)}` : ''}
                    </Typography>
                  </Box>
                  <StatusChip
                    label={root.accessible === false ? 'inaccessible' : low ? 'low space' : 'accessible'}
                    tone={root.accessible === false ? 'bad' : low ? 'warn' : 'good'}
                    t={t}
                    isDark={isDark}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      </Panel>

      {(inaccessibleRoots.length > 0 || lowDisks.length > 0) && (
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, borderColor: `${toneColor('bad', isDark, t)}66` }}>
          <SectionTitle title="Storage exceptions" detail="These conditions can stop imports even when downloads succeed." t={t} />
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {inaccessibleRoots.map((root) => (
              <Typography key={root.id ?? root.path} sx={{ color: t.ink, fontSize: '0.76rem' }}>
                <strong>{root.path || 'Root folder'}:</strong> Sonarr reports this location as inaccessible.
              </Typography>
            ))}
            {lowDisks.map((disk) => (
              <Typography key={disk.path} sx={{ color: t.ink, fontSize: '0.76rem' }}>
                <strong>{disk.label || disk.path || 'Disk'}:</strong> {fmtBytes(disk.freeSpace)} remains from {fmtBytes(disk.totalSpace)}.
              </Typography>
            ))}
          </Box>
        </Panel>
      )}
    </Box>
  );
}
