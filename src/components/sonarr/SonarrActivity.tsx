import { useMemo, useState } from 'react';
import {
  Box,
  FormControl,
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
  Block as BlockIcon,
  Search as SearchIcon,
} from '../../components/AppIcons'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HearthTokens } from '../../theme/tokens';
import type { SonarrData, SonarrHistoryRecord, SonarrInsights, SonarrQueueRecord } from './types';
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

function eventTone(event: string | undefined): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  const value = (event ?? '').toLowerCase();
  if (value.includes('fail')) return 'bad';
  if (value.includes('import')) return 'good';
  if (value.includes('grab')) return 'info';
  if (value.includes('delete')) return 'warn';
  return 'neutral';
}

function queueProgress(item: SonarrQueueRecord): number {
  const size = Number(item.size) || 0;
  const left = Number(item.sizeleft) || 0;
  return size > 0 ? Math.max(0, Math.min(100, ((size - left) / size) * 100)) : 0;
}

function historyTitle(item: SonarrHistoryRecord): string {
  const show = item.series?.title || 'Unknown series';
  const code = item.episode ? episodeCode(item.episode) : null;
  return [show, code, item.episode?.title].filter(Boolean).join(' · ');
}

export default function SonarrActivity({ data, insights, t, isDark }: Props) {
  const [logQuery, setLogQuery] = useState('');
  const [logLevel, setLogLevel] = useState('all');
  const history = recordsOf(data.history);
  const queue = recordsOf(data.queue);
  const blocklist = recordsOf(data.blocklist);
  const logs = recordsOf(data.logs);

  const filteredLogs = useMemo(() => {
    const needle = logQuery.trim().toLowerCase();
    const severity = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const threshold = logLevel === 'all' ? -1 : severity.indexOf(logLevel);
    return logs.filter((item) => {
      const level = (item.level ?? 'info').toLowerCase();
      if (threshold >= 0 && severity.indexOf(level) < threshold) return false;
      return !needle || `${item.logger ?? ''} ${item.message ?? ''} ${item.exception ?? ''}`.toLowerCase().includes(needle);
    });
  }, [logLevel, logQuery, logs]);

  const activity = insights.historyTimeline.map((point) => ({
    ...point,
    label: fmtDate(`${point.date}T12:00:00Z`),
  }));
  const chartStyle = {
    backgroundColor: t.paper,
    border: `1px solid ${t.line}`,
    borderRadius: 10,
    color: t.ink,
    fontSize: 12,
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
        <SectionTitle
          title="Acquisition activity"
          detail="Daily events from the latest 2,000 Sonarr history records."
          t={t}
        />
        <Box sx={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activity} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={t.line} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip contentStyle={chartStyle} />
              <Legend wrapperStyle={{ color: t.muted, fontSize: 11 }} />
              <Bar dataKey="grabbed" name="Grabbed" stackId="events" fill={toneColor('info', isDark, t)} />
              <Bar dataKey="imported" name="Imported" stackId="events" fill={toneColor('good', isDark, t)} />
              <Bar dataKey="failed" name="Failed" stackId="events" fill={toneColor('bad', isDark, t)} />
              <Bar dataKey="deleted" name="Deleted" stackId="events" fill={toneColor('warn', isDark, t)} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Panel>

      <Panel t={t} sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, md: 2 }, pb: 1 }}>
          <SectionTitle
            title="Active queue"
            detail={`${fmtNumber(data.queue?.totalRecords ?? queue.length)} downloads and imports currently tracked.`}
            t={t}
          />
        </Box>
        {queue.length === 0 ? (
          <EmptyState title="Queue is empty" detail="No downloads are active or waiting to import." t={t} />
        ) : (
          <TableContainer sx={{ maxHeight: 420, borderTop: `1px solid ${t.line}` }}>
            <Table stickyHeader size="small" aria-label="Sonarr download queue">
              <TableHead>
                <TableRow>
                  {['Series / release', 'Status', 'Progress', 'Remaining', 'Client'].map((label) => (
                    <TableCell
                      key={label}
                      align={label === 'Progress' || label === 'Remaining' ? 'right' : 'left'}
                      sx={{ bgcolor: t.surface, color: t.muted, borderColor: t.line, fontSize: '0.67rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      {label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.map((item) => {
                  const progress = queueProgress(item);
                  const warning = /(warn|error|fail|stalled|importblocked)/i.test(`${item.trackedDownloadStatus} ${item.trackedDownloadState} ${item.status}`);
                  return (
                    <TableRow key={item.id} hover sx={{ '& td': { borderColor: t.line } }}>
                      <TableCell sx={{ minWidth: 260 }}>
                        <Typography sx={{ color: t.ink, fontSize: '0.74rem', fontWeight: 700 }}>{item.series?.title || item.title || 'Unknown download'}</Typography>
                        <Typography sx={{ color: t.muted, fontSize: '0.64rem', maxWidth: 430, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[item.episode ? episodeCode(item.episode) : null, item.episode?.title, item.quality?.quality?.name].filter(Boolean).join(' · ')}
                        </Typography>
                        {item.statusMessages?.some((message) => message.messages?.length) && (
                          <Typography sx={{ color: toneColor('bad', isDark, t), fontSize: '0.64rem', mt: 0.25 }}>
                            {item.statusMessages.flatMap((message) => message.messages ?? []).join(' · ')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={item.status || item.trackedDownloadState || 'queued'} tone={warning ? 'bad' : 'info'} t={t} isDark={isDark} />
                      </TableCell>
                      <TableCell align="right" sx={{ minWidth: 130 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                          <LinearProgress
                            variant="determinate"
                            value={progress}
                            sx={{ width: 64, height: 5, borderRadius: 8, bgcolor: t.surface, '& .MuiLinearProgress-bar': { bgcolor: warning ? toneColor('bad', isDark, t) : toneColor('info', isDark, t), borderRadius: 8 } }}
                          />
                          <Typography sx={{ color: t.inkSoft, fontSize: '0.68rem', minWidth: 34 }}>{Math.round(progress)}%</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: t.inkSoft, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                        {fmtBytes(item.sizeleft)}
                      </TableCell>
                      <TableCell sx={{ color: t.inkSoft, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{item.downloadClient || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Panel>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.35fr) minmax(320px, 0.65fr)' }, gap: 2 }}>
        <Panel t={t} sx={{ overflow: 'hidden', minWidth: 0 }}>
          <Box sx={{ p: { xs: 1.5, md: 2 }, pb: 1 }}>
            <SectionTitle
              title="Recent history"
              detail={`${fmtNumber(data.history?.totalRecords ?? history.length)} total events; the newest 2,000 are in this report.`}
              t={t}
            />
          </Box>
          <TableContainer sx={{ maxHeight: 520, borderTop: `1px solid ${t.line}` }}>
            <Table stickyHeader size="small" aria-label="Sonarr history">
              <TableHead>
                <TableRow>
                  {['Time', 'Event', 'Episode', 'Quality'].map((label) => (
                    <TableCell key={label} sx={{ bgcolor: t.surface, color: t.muted, borderColor: t.line, fontSize: '0.67rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {history.slice(0, 250).map((item) => (
                  <TableRow key={item.id} hover sx={{ '& td': { borderColor: t.line } }}>
                    <TableCell sx={{ color: t.muted, fontSize: '0.67rem', whiteSpace: 'nowrap' }}>{fmtDate(item.date, true)}</TableCell>
                    <TableCell><StatusChip label={item.eventType || 'event'} tone={eventTone(item.eventType)} t={t} isDark={isDark} /></TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <Typography sx={{ color: t.ink, fontSize: '0.72rem', fontWeight: 650 }}>{historyTitle(item)}</Typography>
                      <Typography sx={{ color: t.muted, fontSize: '0.63rem', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sourceTitle || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ color: t.inkSoft, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{item.quality?.quality?.name || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle
            title="Blocklist"
            detail={`${fmtNumber(data.blocklist?.totalRecords ?? blocklist.length)} rejected releases retained by Sonarr.`}
            t={t}
          />
          {blocklist.length === 0 ? (
            <EmptyState title="Blocklist is empty" detail="No rejected releases are in the current snapshot." t={t} />
          ) : (
            <Box sx={{ display: 'grid', maxHeight: 470, overflowY: 'auto', pr: 0.5 }}>
              {blocklist.slice(0, 80).map((item, index) => (
                <Box key={item.id ?? index} sx={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 1, py: 0.85, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                  <BlockIcon sx={{ color: toneColor('bad', isDark, t), fontSize: 17, mt: 0.15 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: t.ink, fontSize: '0.72rem', fontWeight: 700 }}>{item.series?.title || item.sourceTitle || 'Blocked release'}</Typography>
                    <Typography sx={{ color: t.muted, fontSize: '0.63rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sourceTitle || item.message || '—'}</Typography>
                    <Typography sx={{ color: t.muted, fontSize: '0.62rem', mt: 0.2 }}>{[item.indexer, item.protocol, fmtDate(item.date, true)].filter(Boolean).join(' · ')}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Panel>
      </Box>

      <Panel t={t} sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, md: 2 }, pb: 1.25 }}>
          <SectionTitle
            title="Sonarr logs"
            detail={`${fmtNumber(filteredLogs.length)} of ${fmtNumber(logs.length)} recent entries shown. Sensitive query values are redacted by the collector.`}
            t={t}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(240px, 1fr) 170px' }, gap: 1 }}>
            <TextField
              size="small"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
              placeholder="Search logger or message"
              inputProps={{ 'aria-label': 'Search Sonarr logs' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: t.muted, fontSize: 19 }} /></InputAdornment> }}
              sx={{ '& .MuiOutlinedInput-root': { color: t.ink, bgcolor: t.surface }, '& fieldset': { borderColor: t.line } }}
            />
            <FormControl size="small">
              <Select
                value={logLevel}
                onChange={(event) => setLogLevel(event.target.value)}
                inputProps={{ 'aria-label': 'Minimum Sonarr log level' }}
                sx={{ color: t.ink, bgcolor: t.surface, '& fieldset': { borderColor: t.line } }}
              >
                <MenuItem value="all">All levels</MenuItem>
                <MenuItem value="info">Info and above</MenuItem>
                <MenuItem value="warn">Warn and above</MenuItem>
                <MenuItem value="error">Error only</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>
        {filteredLogs.length === 0 ? (
          <EmptyState title="No matching log entries" detail="Change the search text or minimum level." t={t} />
        ) : (
          <Box sx={{ maxHeight: 560, overflowY: 'auto', borderTop: `1px solid ${t.line}` }}>
            {filteredLogs.slice(0, 300).map((item, index) => {
              const level = (item.level ?? 'info').toLowerCase();
              const tone = level.includes('fatal') || level.includes('error') ? 'bad' : level.includes('warn') ? 'warn' : level.includes('debug') ? 'neutral' : 'info';
              return (
                <Box key={item.id ?? index} sx={{ display: 'grid', gridTemplateColumns: { xs: '74px minmax(0, 1fr)', md: '105px 90px 160px minmax(0, 1fr)' }, gap: 1, px: { xs: 1.5, md: 2 }, py: 0.8, borderTop: index ? `1px solid ${t.line}` : 'none', alignItems: 'start' }}>
                  <Typography sx={{ color: t.muted, fontSize: '0.64rem', whiteSpace: 'nowrap' }}>{fmtDate(item.time, true)}</Typography>
                  <Box sx={{ display: { xs: 'none', md: 'block' } }}><StatusChip label={item.level || 'Info'} tone={tone} t={t} isDark={isDark} /></Box>
                  <Typography sx={{ display: { xs: 'none', md: 'block' }, color: t.inkSoft, fontSize: '0.66rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.logger || 'Sonarr'}</Typography>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: t.ink, fontSize: '0.69rem', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{item.message || '—'}</Typography>
                    {item.exception && <Typography sx={{ color: toneColor('bad', isDark, t), fontSize: '0.64rem', mt: 0.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.exception}</Typography>}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Panel>
    </Box>
  );
}
