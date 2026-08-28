import { Box, LinearProgress, Typography } from '@mui/material';
import {
  CheckCircleOutline as CheckIcon,
  ErrorOutline as ErrorIcon,
  Schedule as ScheduleIcon,
  Storage as StorageIcon,
  WarningAmber as WarningIcon,
} from '../../components/AppIcons'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HearthTokens } from '../../theme/tokens';
import type {
  SonarrData,
  SonarrEpisode,
  SonarrInsights,
  SonarrQueueRecord,
  SonarrTrendPoint,
} from './types';
import {
  EmptyState,
  Panel,
  SectionTitle,
  StatusChip,
} from './sonarrUi';
import { fmtBytes, fmtDate, fmtNumber, fmtRelative, recordsOf, toneColor } from './sonarrFormat';

interface Props {
  data: SonarrData;
  insights: SonarrInsights;
  trends: SonarrTrendPoint[];
  t: HearthTokens;
  isDark: boolean;
}

function queueProgress(item: SonarrQueueRecord): number {
  const size = Number(item.size) || 0;
  const left = Number(item.sizeleft) || 0;
  return size > 0 ? Math.max(0, Math.min(100, ((size - left) / size) * 100)) : 0;
}

export default function SonarrOverview({ data, insights, trends, t, isDark }: Props) {
  const queue = recordsOf(data.queue);
  const health = recordsOf(data.health);
  const disks = recordsOf(data.diskSpace);
  const failedEndpoints = insights.collection.failedEndpointCount;
  const problemDownloads = queue.filter((item) => {
    const state = `${item.trackedDownloadState ?? ''} ${item.trackedDownloadStatus ?? ''} ${item.status ?? ''}`.toLowerCase();
    return /(warn|error|fail|stalled|importblocked)/.test(state);
  });
  const lowDisks = disks.filter((disk) => {
    const total = Number(disk.totalSpace) || 0;
    return total > 0 && (Number(disk.freeSpace) || 0) / total < 0.15;
  });

  const activity = insights.historyTimeline.map((point) => ({
    ...point,
    label: fmtDate(`${point.date}T12:00:00Z`),
  }));
  const statusData = insights.breakdowns.seriesStatus.slice(0, 8);

  const attention = [
    ...health.map((item) => ({
      key: `health-${item.source}-${item.message}`,
      title: item.message || 'Sonarr health check needs attention',
      detail: item.source || item.type || 'Health check',
      tone: item.type?.toLowerCase() === 'error' ? 'bad' as const : 'warn' as const,
      icon: <WarningIcon fontSize="small" />,
    })),
    ...problemDownloads.slice(0, 4).map((item) => ({
      key: `queue-${item.id}`,
      title: item.series?.title || item.title || 'Download needs attention',
      detail: item.statusMessages?.flatMap((message) => message.messages ?? []).join(' · ')
        || item.trackedDownloadStatus
        || item.trackedDownloadState
        || 'Queue warning',
      tone: 'bad' as const,
      icon: <ErrorIcon fontSize="small" />,
    })),
    ...lowDisks.map((disk) => ({
      key: `disk-${disk.path}`,
      title: `${disk.label || disk.path || 'Disk'} is running low`,
      detail: `${fmtBytes(disk.freeSpace)} free of ${fmtBytes(disk.totalSpace)}`,
      tone: 'warn' as const,
      icon: <StorageIcon fontSize="small" />,
    })),
    ...(failedEndpoints > 0 ? [{
      key: 'coverage',
      title: `${failedEndpoints} API source${failedEndpoints === 1 ? '' : 's'} unavailable`,
      detail: 'The last snapshot is usable, but the System tab lists the missing sources.',
      tone: 'warn' as const,
      icon: <WarningIcon fontSize="small" />,
    }] : []),
  ];

  const chartStyle = {
    backgroundColor: t.paper,
    border: `1px solid ${t.line}`,
    borderRadius: 10,
    color: t.ink,
    fontSize: 12,
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle
          title="Library pulse"
          detail="Current coverage across every monitored and unmonitored series."
          t={t}
        />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
            borderTop: `1px solid ${t.line}`,
            borderLeft: `1px solid ${t.line}`,
          }}
        >
          {[
            ['Series', fmtNumber(insights.metrics.seriesCount), `${fmtNumber(insights.metrics.monitoredSeriesCount)} monitored`],
            ['Episodes', fmtNumber(insights.metrics.episodeCount), `${fmtNumber(insights.metrics.episodeFileCount)} on disk`],
            ['Coverage', `${insights.metrics.episodeCount ? Math.round((insights.metrics.episodeFileCount / insights.metrics.episodeCount) * 100) : 0}%`, 'episode files available'],
            ['Wanted', fmtNumber(insights.metrics.missingCount), 'monitored episodes missing'],
            ['Below cutoff', fmtNumber(insights.metrics.cutoffUnmetCount), 'quality upgrades available'],
            ['Library size', fmtBytes(insights.metrics.librarySizeBytes), `${fmtBytes(insights.metrics.freeSpaceBytes)} free`],
          ].map(([label, value, detail]) => (
            <Box
              key={label}
              sx={{
                px: 1.5,
                py: 1.35,
                minWidth: 0,
                borderRight: `1px solid ${t.line}`,
                borderBottom: `1px solid ${t.line}`,
              }}
            >
              <Typography sx={{ color: t.muted, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {label}
              </Typography>
              <Typography sx={{ color: t.ink, fontSize: { xs: '1.18rem', md: '1.35rem' }, fontWeight: 800, lineHeight: 1.25, mt: 0.35 }}>
                {value}
              </Typography>
              <Typography sx={{ color: t.muted, fontSize: '0.68rem', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {detail}
              </Typography>
            </Box>
          ))}
        </Box>
      </Panel>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(300px, 0.75fr)' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle
            title="Thirty-day pipeline"
            detail="Grab, import, and failure events from Sonarr history."
            t={t}
          />
          <Box sx={{ height: 290, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="sonarrImported" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={toneColor('good', isDark, t)} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={toneColor('good', isDark, t)} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" stroke={t.muted} tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis stroke={t.muted} tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip contentStyle={chartStyle} />
                <Area type="monotone" dataKey="imported" name="Imported" stroke={toneColor('good', isDark, t)} fill="url(#sonarrImported)" strokeWidth={2} />
                <Area type="monotone" dataKey="grabbed" name="Grabbed" stroke={toneColor('info', isDark, t)} fill="transparent" strokeWidth={1.7} />
                <Area type="monotone" dataKey="failed" name="Failed" stroke={toneColor('bad', isDark, t)} fill="transparent" strokeWidth={1.7} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle
            title="Attention"
            detail="Problems that can interrupt the TV pipeline."
            t={t}
          />
          {attention.length === 0 ? (
            <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', py: 2 }}>
              <CheckIcon sx={{ color: toneColor('good', isDark, t) }} />
              <Box>
                <Typography sx={{ color: t.ink, fontSize: '0.84rem', fontWeight: 750 }}>Pipeline is clear</Typography>
                <Typography sx={{ color: t.muted, fontSize: '0.73rem' }}>No health, queue, disk, or collection warnings.</Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'grid' }}>
              {attention.slice(0, 8).map((item, index) => {
                const color = toneColor(item.tone, isDark, t);
                return (
                  <Box
                    key={item.key}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '24px minmax(0, 1fr)',
                      gap: 1,
                      py: 1.05,
                      borderTop: index ? `1px solid ${t.line}` : 'none',
                    }}
                  >
                    <Box sx={{ color, pt: 0.1 }}>{item.icon}</Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: t.ink, fontSize: '0.78rem', fontWeight: 700 }}>{item.title}</Typography>
                      <Typography sx={{ color: t.muted, fontSize: '0.7rem', mt: 0.2, lineHeight: 1.4 }}>{item.detail}</Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Panel>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.1fr) minmax(0, 0.9fr)' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle
            title="Download queue"
            detail={`${fmtNumber(data.queue?.totalRecords ?? queue.length)} active item${(data.queue?.totalRecords ?? queue.length) === 1 ? '' : 's'}.`}
            t={t}
          />
          {queue.length === 0 ? (
            <EmptyState title="Queue is empty" detail="Nothing is waiting to download or import." t={t} />
          ) : (
            <Box sx={{ display: 'grid' }}>
              {queue.slice(0, 8).map((item, index) => {
                const progress = queueProgress(item);
                const warning = problemDownloads.some((problem) => problem.id === item.id);
                return (
                  <Box key={item.id} sx={{ py: 1, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Typography sx={{ minWidth: 0, color: t.ink, fontSize: '0.78rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.series?.title || item.title || 'Unknown download'}
                      </Typography>
                      <StatusChip
                        label={warning ? 'needs attention' : item.status || item.trackedDownloadState || 'queued'}
                        tone={warning ? 'bad' : progress >= 100 ? 'good' : 'info'}
                        t={t}
                        isDark={isDark}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mt: 0.65 }}>
                      <LinearProgress
                        variant="determinate"
                        value={progress}
                        sx={{
                          flex: 1,
                          height: 5,
                          borderRadius: 10,
                          bgcolor: t.surface,
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 10,
                            bgcolor: warning ? toneColor('bad', isDark, t) : toneColor('info', isDark, t),
                          },
                        }}
                      />
                      <Typography sx={{ color: t.muted, fontSize: '0.68rem', minWidth: 42, textAlign: 'right' }}>
                        {Math.round(progress)}%
                      </Typography>
                    </Box>
                    <Typography sx={{ color: t.muted, fontSize: '0.68rem', mt: 0.45 }}>
                      {[item.quality?.quality?.name, item.downloadClient, item.timeleft ? `${item.timeleft} left` : null].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle
            title="Library composition"
            detail="Series grouped by current Sonarr status."
            t={t}
          />
          <Box sx={{ height: 235 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={t.line} strokeDasharray="3 5" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={90}
                  tick={{ fill: t.muted, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip contentStyle={chartStyle} />
                <Bar dataKey="value" name="Series" fill={isDark ? t.rustLight : t.rustDark} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      </Box>

      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle
          title="Coming up"
          detail="The next episodes Sonarr expects to air."
          t={t}
        />
        {insights.upcoming.length === 0 ? (
          <EmptyState title="No upcoming episodes" detail="The current 28-day calendar has no future airings." t={t} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, columnGap: 3 }}>
            {insights.upcoming.slice(0, 10).map((episode, index) => (
              <Box
                key={`${episode.id}-${index}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '28px minmax(0, 1fr) auto',
                  gap: 1,
                  alignItems: 'center',
                  py: 0.9,
                  borderTop: index > 1 ? `1px solid ${t.line}` : { xs: index ? `1px solid ${t.line}` : 'none', md: 'none' },
                }}
              >
                <ScheduleIcon sx={{ color: t.rust, fontSize: 18 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: t.ink, fontSize: '0.77rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(episode as SonarrEpisode & { series?: { title?: string } }).series?.title || episode.title || 'Upcoming episode'}
                  </Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {episode.title || 'Title not available'}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ color: t.inkSoft, fontSize: '0.7rem', fontWeight: 650 }}>
                    {fmtDate(episode.airDateUtc || episode.airDate)}
                  </Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.65rem' }}>
                    {fmtRelative(episode.airDateUtc || episode.airDate)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Panel>

      {trends.length > 1 && (
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle
            title="Marquee snapshot trend"
            detail="Long-range episode-file coverage captured by the on-site agent."
            t={t}
          />
          <Box sx={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends.map((point) => ({
                ...point,
                label: fmtDate(point.sampled_at),
              }))} margin={{ top: 5, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={36} />
                <YAxis tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                <ChartTooltip contentStyle={chartStyle} />
                <Area type="monotone" dataKey="episode_file_count" name="Episode files" stroke={toneColor('good', isDark, t)} fill={`${toneColor('good', isDark, t)}22`} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      )}
    </Box>
  );
}
