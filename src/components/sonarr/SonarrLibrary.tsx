import { apiClient } from '../../services/apiClient'
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Tv as TvIcon,
} from '../../components/AppIcons'
import {
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
  SonarrSeries,
  SonarrSeriesDetailResponse,
} from './types';
import {
  EmptyState,
  Panel,
  SectionTitle,
  StatusChip,
} from './sonarrUi';
import { episodeCode, fmtBytes, fmtDate, fmtNumber, recordsOf, toneColor } from './sonarrFormat';

interface Props {
  data: SonarrData;
  insights: SonarrInsights;
  t: HearthTokens;
  isDark: boolean;
}

type SeriesFilter = 'all' | 'monitored' | 'unmonitored' | 'incomplete' | 'ended';

function completion(series: SonarrSeries): number {
  return Math.max(0, Math.min(100, Number(series.statistics?.percentOfEpisodes) || 0));
}

function seriesForEpisode(episode: SonarrEpisode): { id?: number; title?: string } | undefined {
  return (episode as SonarrEpisode & { series?: { id?: number; title?: string } }).series;
}

export default function SonarrLibrary({ data, insights, t, isDark }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SeriesFilter>('all');
  const [selected, setSelected] = useState<SonarrSeries | null>(null);
  const [detail, setDetail] = useState<SonarrSeriesDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const series = recordsOf(data.series);
  const missing = recordsOf(data.missing);
  const qualityNames = useMemo(() => new Map(
    recordsOf(data.qualityProfiles).map((profile) => [
      Number(profile.id),
      String(profile.name ?? `Profile ${profile.id ?? '?'}`),
    ]),
  ), [data.qualityProfiles]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return series
      .filter((item) => {
        if (needle && !`${item.title} ${item.network ?? ''} ${item.path ?? ''}`.toLowerCase().includes(needle)) return false;
        if (filter === 'monitored') return item.monitored;
        if (filter === 'unmonitored') return !item.monitored;
        if (filter === 'incomplete') return item.monitored && completion(item) < 100;
        if (filter === 'ended') return item.ended || item.status?.toLowerCase() === 'ended';
        return true;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [filter, query, series]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    apiClient.fetch(`/api/sonarr/series/${selected.id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SonarrSeriesDetailResponse;
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setDetail(body);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDetailError(error instanceof Error ? error.message : 'Series detail could not be loaded');
      });
    return () => controller.abort();
  }, [selected]);

  const chartStyle = {
    backgroundColor: t.paper,
    border: `1px solid ${t.line}`,
    borderRadius: 10,
    color: t.ink,
    fontSize: 12,
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle title="Networks" detail="Where the active library comes from." t={t} />
          <Box sx={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={insights.breakdowns.networks.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={t.line} strokeDasharray="3 5" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={115} tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                <ChartTooltip contentStyle={chartStyle} />
                <Bar dataKey="value" name="Series" fill={toneColor('info', isDark, t)} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <SectionTitle title="Quality profiles" detail="Series distribution across Sonarr upgrade policies." t={t} />
          <Box sx={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={insights.breakdowns.qualityProfiles.slice(0, 10)} margin={{ top: 8, right: 8, left: -20, bottom: 40 }}>
                <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="name" angle={-28} textAnchor="end" interval={0} tick={{ fill: t.muted, fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip contentStyle={chartStyle} />
                <Bar dataKey="value" name="Series" fill={isDark ? t.rustLight : t.rustDark} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      </Box>

      <Panel t={t} sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, md: 2 }, pb: 1.25 }}>
          <SectionTitle
            title="Series catalog"
            detail={`${fmtNumber(filtered.length)} of ${fmtNumber(series.length)} series shown. Select a title for episode and file detail.`}
            t={t}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(240px, 1fr) 190px' }, gap: 1 }}>
            <TextField
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, network, or path"
              inputProps={{ 'aria-label': 'Search Sonarr series' }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: t.muted, fontSize: 19 }} /></InputAdornment>,
              }}
              sx={{
                '& .MuiOutlinedInput-root': { color: t.ink, bgcolor: t.surface },
                '& fieldset': { borderColor: t.line },
              }}
            />
            <FormControl size="small">
              <Select
                value={filter}
                onChange={(event) => setFilter(event.target.value as SeriesFilter)}
                inputProps={{ 'aria-label': 'Filter Sonarr series' }}
                sx={{ color: t.ink, bgcolor: t.surface, '& fieldset': { borderColor: t.line } }}
              >
                <MenuItem value="all">All series</MenuItem>
                <MenuItem value="monitored">Monitored</MenuItem>
                <MenuItem value="unmonitored">Unmonitored</MenuItem>
                <MenuItem value="incomplete">Incomplete</MenuItem>
                <MenuItem value="ended">Ended</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        <TableContainer sx={{ maxHeight: 560, borderTop: `1px solid ${t.line}` }}>
          <Table stickyHeader size="small" aria-label="Sonarr series catalog">
            <TableHead>
              <TableRow>
                {['Series', 'Network', 'Status', 'Quality', 'Coverage', 'On disk'].map((label) => (
                  <TableCell
                    key={label}
                    align={label === 'Coverage' || label === 'On disk' ? 'right' : 'left'}
                    sx={{ bgcolor: t.surface, color: t.muted, borderColor: t.line, fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => {
                const pct = completion(item);
                return (
                  <TableRow key={item.id} hover sx={{ '& td': { borderColor: t.line } }}>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Button
                        variant="text"
                        onClick={() => setSelected(item)}
                        sx={{ p: 0, minWidth: 0, color: t.ink, textTransform: 'none', justifyContent: 'flex-start', fontSize: '0.78rem', fontWeight: 750, textAlign: 'left' }}
                      >
                        {item.title}
                      </Button>
                      <Typography sx={{ color: t.muted, fontSize: '0.65rem', mt: 0.15 }}>
                        {[item.year, item.seriesType].filter(Boolean).join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: t.inkSoft, fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{item.network || '—'}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={!item.monitored ? 'unmonitored' : item.status || 'unknown'}
                        tone={!item.monitored ? 'neutral' : item.ended ? 'neutral' : 'good'}
                        t={t}
                        isDark={isDark}
                      />
                    </TableCell>
                    <TableCell sx={{ color: t.inkSoft, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {item.profileName || qualityNames.get(Number(item.qualityProfileId)) || `Profile ${item.qualityProfileId ?? '—'}`}
                    </TableCell>
                    <TableCell align="right" sx={{ minWidth: 130 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{
                            width: 62,
                            height: 5,
                            borderRadius: 8,
                            bgcolor: t.surface,
                            '& .MuiLinearProgress-bar': { borderRadius: 8, bgcolor: pct >= 100 ? toneColor('good', isDark, t) : toneColor('warn', isDark, t) },
                          }}
                        />
                        <Typography sx={{ color: t.inkSoft, fontSize: '0.7rem', minWidth: 34 }}>{Math.round(pct)}%</Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: t.inkSoft, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {fmtBytes(item.statistics?.sizeOnDisk)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {filtered.length === 0 && <EmptyState title="No series match" detail="Try a different search or filter." t={t} />}
      </Panel>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle
            title="Lowest coverage"
            detail="Monitored series with the largest episode-file gap."
            t={t}
          />
          {insights.incompleteSeries.length === 0 ? (
            <EmptyState title="Everything is complete" detail="Every monitored series has full episode coverage." t={t} />
          ) : (
            <Box sx={{ display: 'grid' }}>
              {insights.incompleteSeries.slice(0, 12).map((item, index) => (
                <Box key={item.id} sx={{ py: 0.85, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Button
                      variant="text"
                      onClick={() => setSelected(series.find((candidate) => candidate.id === item.id) ?? null)}
                      sx={{ color: t.ink, p: 0, minWidth: 0, textTransform: 'none', fontSize: '0.76rem', fontWeight: 700, justifyContent: 'flex-start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {item.title}
                    </Button>
                    <Typography sx={{ color: t.inkSoft, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                      {item.episodeFileCount}/{item.episodeCount}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={item.percentOfEpisodes}
                    sx={{
                      mt: 0.55,
                      height: 4,
                      borderRadius: 8,
                      bgcolor: t.surface,
                      '& .MuiLinearProgress-bar': { bgcolor: toneColor(item.percentOfEpisodes < 50 ? 'bad' : 'warn', isDark, t), borderRadius: 8 },
                    }}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle
            title="Recently aired and missing"
            detail={`${fmtNumber(data.missing?.totalRecords ?? missing.length)} monitored episodes are wanted.`}
            t={t}
          />
          {missing.length === 0 ? (
            <EmptyState title="No missing episodes" detail="Sonarr reports no monitored episodes waiting for a file." t={t} />
          ) : (
            <Box sx={{ display: 'grid' }}>
              {missing.slice(0, 14).map((episode, index) => {
                const owner = seriesForEpisode(episode);
                return (
                  <Box key={episode.id} sx={{ display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) auto', gap: 1, alignItems: 'center', py: 0.82, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                    <Typography sx={{ color: t.rust, fontSize: '0.69rem', fontWeight: 800 }}>{episodeCode(episode)}</Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: t.ink, fontSize: '0.75rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {owner?.title || 'Unknown series'}
                      </Typography>
                      <Typography sx={{ color: t.muted, fontSize: '0.67rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {episode.title || 'Untitled episode'}
                      </Typography>
                    </Box>
                    <Typography sx={{ color: t.muted, fontSize: '0.67rem', whiteSpace: 'nowrap' }}>{fmtDate(episode.airDateUtc || episode.airDate)}</Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </Panel>
      </Box>

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 520 },
              bgcolor: t.bg,
              color: t.ink,
              borderLeft: `1px solid ${t.line}`,
              backgroundImage: 'none',
            },
          },
        }}
      >
        {selected && (
          <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
              <Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 2, bgcolor: `${t.rust}1A`, color: t.rust }}>
                <TvIcon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography component="h2" sx={{ color: t.ink, fontSize: '1.25rem', lineHeight: 1.2, fontWeight: 850 }}>{selected.title}</Typography>
                <Typography sx={{ color: t.muted, mt: 0.35, fontSize: '0.74rem' }}>
                  {[selected.network, selected.year, selected.seriesType].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <IconButton onClick={() => setSelected(null)} aria-label="Close series detail" sx={{ color: t.muted }}>
                <CloseIcon />
              </IconButton>
            </Box>

            <Panel t={t} sx={{ p: 1.5, mb: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
                {[
                  ['Coverage', `${Math.round(completion(selected))}%`],
                  ['Files', fmtNumber(selected.statistics?.episodeFileCount)],
                  ['On disk', fmtBytes(selected.statistics?.sizeOnDisk)],
                ].map(([label, value]) => (
                  <Box key={label}>
                    <Typography sx={{ color: t.muted, fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 750 }}>{label}</Typography>
                    <Typography sx={{ color: t.ink, fontSize: '0.95rem', fontWeight: 800, mt: 0.25 }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
            </Panel>

            {selected.overview && (
              <Typography sx={{ color: t.inkSoft, fontSize: '0.8rem', lineHeight: 1.6, mb: 2 }}>
                {selected.overview}
              </Typography>
            )}

            {!detail && !detailError && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={26} sx={{ color: t.rust }} />
              </Box>
            )}
            {detailError && <EmptyState title="Series detail unavailable" detail={detailError} t={t} />}
            {detail && (
              <>
                <SectionTitle
                  title="Episode inventory"
                  detail={`${fmtNumber(detail.episodes.length)} episodes · ${fmtNumber(detail.episodeFiles.length)} files in the exhaustive snapshot.`}
                  t={t}
                />
                <Box sx={{ display: 'grid', maxHeight: '58vh', overflowY: 'auto', pr: 0.5 }}>
                  {detail.episodes
                    .slice()
                    .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) || (b.episodeNumber ?? 0) - (a.episodeNumber ?? 0))
                    .map((episode, index) => (
                      <Box key={episode.id} sx={{ display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr) auto', gap: 1, py: 0.8, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                        <Typography sx={{ color: t.rust, fontSize: '0.68rem', fontWeight: 800 }}>{episodeCode(episode)}</Typography>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ color: t.ink, fontSize: '0.73rem', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{episode.title || 'Untitled episode'}</Typography>
                          <Typography sx={{ color: t.muted, fontSize: '0.65rem' }}>{fmtDate(episode.airDateUtc || episode.airDate)}</Typography>
                        </Box>
                        <StatusChip label={episode.hasFile ? 'on disk' : episode.monitored ? 'missing' : 'unmonitored'} tone={episode.hasFile ? 'good' : episode.monitored ? 'warn' : 'neutral'} t={t} isDark={isDark} />
                      </Box>
                    ))}
                </Box>
              </>
            )}
          </Box>
        )}
      </Drawer>
    </Box>
  );
}
