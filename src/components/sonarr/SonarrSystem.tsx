import { Box, Typography } from '@mui/material';
import {
  CheckCircleOutline as CheckIcon,
  CloudDone as IntegrationIcon,
  ErrorOutline as ErrorIcon,
  Schedule as TaskIcon,
  Security as SecurityIcon,
  Storage as BackupIcon,
  SystemUpdateAlt as UpdateIcon,
} from '../../components/AppIcons'
import type { HearthTokens } from '../../theme/tokens';
import type {
  SonarrData,
  SonarrDiagnostic,
  SonarrHealth,
  SonarrIntegration,
  SonarrSnapshot,
} from './types';
import {
  EmptyState,
  Panel,
  SectionTitle,
  StatusChip,
} from './sonarrUi';
import { fmtBytes, fmtDate, fmtNumber, fmtRelative, recordsOf, toneColor } from './sonarrFormat';

interface Props {
  snapshot: SonarrSnapshot;
  data: SonarrData;
  t: HearthTokens;
  isDark: boolean;
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(valueLabel).join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function IntegrationList({
  title,
  rows,
  t,
  isDark,
}: {
  title: string;
  rows: SonarrIntegration[];
  t: HearthTokens;
  isDark: boolean;
}) {
  return (
    <Box>
      <Typography sx={{ color: t.muted, fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.65 }}>
        {title}
      </Typography>
      {rows.length === 0 ? (
        <Typography sx={{ color: t.muted, fontSize: '0.72rem' }}>None configured</Typography>
      ) : (
        <Box sx={{ display: 'grid' }}>
          {rows.map((row, index) => (
            <Box key={row.id ?? `${title}-${index}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.65, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: t.ink, fontSize: '0.73rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.name || row.implementationName || row.implementation || 'Unnamed integration'}
                </Typography>
                <Typography sx={{ color: t.muted, fontSize: '0.63rem' }}>
                  {[row.implementation, row.protocol, row.priority != null ? `priority ${row.priority}` : null].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <StatusChip label={row.enable === false ? 'disabled' : 'enabled'} tone={row.enable === false ? 'neutral' : 'good'} t={t} isDark={isDark} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function DiagnosticRow({
  item,
  t,
  isDark,
}: {
  item: SonarrDiagnostic;
  t: HearthTokens;
  isDark: boolean;
}) {
  const color = toneColor(item.ok ? 'good' : 'bad', isDark, t);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '22px minmax(0, 1fr) auto', md: '22px minmax(150px, 0.55fr) minmax(220px, 1fr) 80px 80px' }, gap: 1, alignItems: 'center', px: { xs: 1.5, md: 2 }, py: 0.75, borderTop: `1px solid ${t.line}` }}>
      {item.ok ? <CheckIcon sx={{ color, fontSize: 17 }} /> : <ErrorIcon sx={{ color, fontSize: 17 }} />}
      <Typography sx={{ color: t.ink, fontSize: '0.7rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.key}</Typography>
      <Typography sx={{ display: { xs: 'none', md: 'block' }, color: t.muted, fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path}</Typography>
      <Typography sx={{ display: { xs: 'none', md: 'block' }, color: t.inkSoft, fontSize: '0.66rem', textAlign: 'right' }}>{fmtNumber(item.count)}</Typography>
      <Typography sx={{ color: t.muted, fontSize: '0.64rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.duration_ms} ms</Typography>
      {!item.ok && (
        <Typography sx={{ gridColumn: { xs: '2 / -1', md: '2 / -1' }, color, fontSize: '0.64rem', lineHeight: 1.4 }}>{item.error || 'Endpoint unavailable'}</Typography>
      )}
    </Box>
  );
}

function HealthList({ rows, t, isDark }: { rows: SonarrHealth[]; t: HearthTokens; isDark: boolean }) {
  if (!rows.length) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25 }}>
        <CheckIcon sx={{ color: toneColor('good', isDark, t) }} />
        <Box>
          <Typography sx={{ color: t.ink, fontSize: '0.78rem', fontWeight: 750 }}>No health warnings</Typography>
          <Typography sx={{ color: t.muted, fontSize: '0.68rem' }}>Sonarr's health endpoint returned a clean result.</Typography>
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid' }}>
      {rows.map((item, index) => (
        <Box key={`${item.source}-${item.message}-${index}`} sx={{ py: 0.8, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
          <Typography sx={{ color: toneColor(item.type?.toLowerCase() === 'error' ? 'bad' : 'warn', isDark, t), fontSize: '0.73rem', fontWeight: 750 }}>{item.message || 'Health warning'}</Typography>
          <Typography sx={{ color: t.muted, fontSize: '0.64rem', mt: 0.2 }}>{[item.source, item.type].filter(Boolean).join(' · ')}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function SonarrSystem({ snapshot, data, t, isDark }: Props) {
  const status = data.systemStatus ?? {};
  const health = recordsOf(data.health);
  const tasks = recordsOf(data.tasks).slice().sort((a, b) => (
    new Date(a.nextExecution ?? 0).getTime() - new Date(b.nextExecution ?? 0).getTime()
  ));
  const backups = recordsOf(data.backups).slice().sort((a, b) => (
    new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime()
  ));
  const updates = recordsOf(data.updates);
  const latestUpdate = updates.find((update) => update.latest) ?? updates[0];
  const diagnostics = snapshot.collection.endpoints.slice().sort((a, b) => (
    Number(a.ok) - Number(b.ok) || a.key.localeCompare(b.key)
  ));

  const configGroups = [
    ['Host', data.hostConfig],
    ['Media management', data.mediaManagementConfig],
    ['Download handling', data.downloadClientConfig],
    ['Indexer', data.indexerConfig],
    ['Import lists', data.importListConfig],
    ['Interface', data.uiConfig],
  ] as const;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.2fr) minmax(320px, 0.8fr)' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle title="Runtime" detail="The Sonarr process and collector currently supplying this dashboard." t={t} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, columnGap: 3 }}>
            {[
              ['Instance', status.instanceName || snapshot.source.label || 'Sonarr'],
              ['Version', status.version || snapshot.source.version || '—'],
              ['Branch', status.branch || snapshot.source.branch || '—'],
              ['Runtime', [status.runtimeName, status.runtimeVersion].filter(Boolean).join(' ') || snapshot.source.runtimeVersion || '—'],
              ['Operating system', [status.osName, status.osVersion].filter(Boolean).join(' ') || '—'],
              ['Database', [status.databaseType, status.databaseVersion].filter(Boolean).join(' ') || snapshot.source.databaseType || '—'],
              ['Started', status.startTime ? `${fmtDate(status.startTime, true)} (${fmtRelative(status.startTime)})` : '—'],
              ['Agent', `build ${snapshot.agent.build} · fast ${snapshot.agent.poll_minutes}m · full ${snapshot.agent.full_poll_minutes}m`],
            ].map(([label, value], index) => (
              <Box key={label} sx={{ py: 0.75, borderTop: index > 1 ? `1px solid ${t.line}` : { xs: index ? `1px solid ${t.line}` : 'none', sm: 'none' } }}>
                <Typography sx={{ color: t.muted, fontSize: '0.63rem', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</Typography>
                <Typography sx={{ color: t.ink, fontSize: '0.75rem', fontWeight: 650, mt: 0.2, overflowWrap: 'anywhere' }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle title="Health" detail="Sonarr's own health checks, not an inferred status." t={t} />
          <HealthList rows={health} t={t} isDark={isDark} />
        </Panel>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle
            title="Scheduled tasks"
            detail={`${fmtNumber(tasks.length)} background jobs reported by Sonarr.`}
            t={t}
          />
          <Box sx={{ display: 'grid', maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
            {tasks.map((task, index) => (
              <Box key={task.id ?? task.taskName ?? index} sx={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', gap: 1, py: 0.75, borderTop: index ? `1px solid ${t.line}` : 'none', alignItems: 'center' }}>
                <TaskIcon sx={{ color: t.rust, fontSize: 17 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: t.ink, fontSize: '0.71rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name || task.taskName || 'Task'}</Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.62rem' }}>last {fmtRelative(task.lastExecution || task.lastStartTime)}</Typography>
                </Box>
                <Typography sx={{ color: t.inkSoft, fontSize: '0.64rem', whiteSpace: 'nowrap' }}>{fmtRelative(task.nextExecution)}</Typography>
              </Box>
            ))}
          </Box>
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle title="Backups" detail={`${fmtNumber(backups.length)} backup archives known to Sonarr.`} t={t} />
          {backups.length === 0 ? (
            <EmptyState title="No backups reported" detail="Sonarr returned an empty backup list." t={t} />
          ) : (
            <Box sx={{ display: 'grid' }}>
              {backups.slice(0, 10).map((backup, index) => (
                <Box key={backup.id ?? backup.path ?? index} sx={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', gap: 1, py: 0.75, borderTop: index ? `1px solid ${t.line}` : 'none', alignItems: 'center' }}>
                  <BackupIcon sx={{ color: toneColor('good', isDark, t), fontSize: 17 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: t.ink, fontSize: '0.71rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{backup.name || backup.type || 'Backup'}</Typography>
                    <Typography sx={{ color: t.muted, fontSize: '0.62rem' }}>{fmtDate(backup.time, true)}</Typography>
                  </Box>
                  <Typography sx={{ color: t.inkSoft, fontSize: '0.64rem' }}>{fmtBytes(backup.size)}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Panel>

        <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
          <SectionTitle title="Updates" detail={`${fmtNumber(updates.length)} releases in Sonarr's update feed.`} t={t} />
          {latestUpdate ? (
            <Box>
              <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'flex-start' }}>
                <UpdateIcon sx={{ color: t.rust }} />
                <Box>
                  <Typography sx={{ color: t.ink, fontSize: '1rem', fontWeight: 800 }}>Version {latestUpdate.version || 'unknown'}</Typography>
                  <Typography sx={{ color: t.muted, fontSize: '0.68rem', mt: 0.25 }}>{fmtDate(latestUpdate.releaseDate)} · {latestUpdate.branch || status.branch || 'main'}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.7, flexWrap: 'wrap', mt: 1.4 }}>
                <StatusChip label={latestUpdate.installed ? 'installed' : latestUpdate.installable ? 'installable' : 'available'} tone={latestUpdate.installed ? 'good' : 'info'} t={t} isDark={isDark} />
                {latestUpdate.latest && <StatusChip label="latest" tone="good" t={t} isDark={isDark} />}
              </Box>
              {latestUpdate.changes && (
                <Typography sx={{ color: t.inkSoft, fontSize: '0.7rem', mt: 1.2, lineHeight: 1.5 }}>
                  {fmtNumber(latestUpdate.changes.new?.length ?? 0)} additions · {fmtNumber(latestUpdate.changes.fixed?.length ?? 0)} fixes
                </Typography>
              )}
            </Box>
          ) : (
            <EmptyState title="No update feed" detail="Sonarr did not return update information." t={t} />
          )}
        </Panel>
      </Box>

      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle
          title="Integration inventory"
          detail="Names and capability flags only. Credential fields never leave nordtorrent."
          action={<SecurityIcon sx={{ color: toneColor('good', isDark, t) }} />}
          t={t}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
          <IntegrationList title="Download clients" rows={recordsOf(data.downloadClients)} t={t} isDark={isDark} />
          <IntegrationList title="Indexers" rows={recordsOf(data.indexers)} t={t} isDark={isDark} />
          <IntegrationList title="Import lists" rows={recordsOf(data.importLists)} t={t} isDark={isDark} />
          <IntegrationList title="Notifications" rows={recordsOf(data.notifications)} t={t} isDark={isDark} />
          <IntegrationList title="Metadata consumers" rows={recordsOf(data.metadataConsumers)} t={t} isDark={isDark} />
          <Box>
            <Typography sx={{ color: t.muted, fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.65 }}>
              Connection summary
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.65 }}>
              <IntegrationIcon sx={{ color: toneColor('good', isDark, t), fontSize: 18 }} />
              <Typography sx={{ color: t.ink, fontSize: '0.73rem', fontWeight: 700 }}>
                {snapshot.insights.integrations.enabledDownloadClients}/{snapshot.insights.integrations.downloadClients} clients · {snapshot.insights.integrations.enabledIndexers}/{snapshot.insights.integrations.indexers} indexers enabled
              </Typography>
            </Box>
          </Box>
        </Box>
      </Panel>

      <Panel t={t} sx={{ p: { xs: 1.5, md: 2 } }}>
        <SectionTitle title="Sanitized configuration report" detail="Operational settings are visible; secrets and integration field values are intentionally absent." t={t} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
          {configGroups.map(([title, config]) => (
            <Box key={title}>
              <Typography sx={{ color: t.rust, fontSize: '0.67rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.6 }}>{title}</Typography>
              {config && Object.keys(config).length ? (
                <Box sx={{ display: 'grid' }}>
                  {Object.entries(config).filter(([key]) => key !== 'id').map(([key, value], index) => (
                    <Box key={key} sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 0.7fr) minmax(0, 1fr)', gap: 1, py: 0.55, borderTop: index ? `1px solid ${t.line}` : 'none' }}>
                      <Typography sx={{ color: t.muted, fontSize: '0.65rem', overflowWrap: 'anywhere' }}>{key}</Typography>
                      <Typography sx={{ color: t.inkSoft, fontSize: '0.65rem', textAlign: 'right', overflowWrap: 'anywhere' }}>{valueLabel(value)}</Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography sx={{ color: t.muted, fontSize: '0.7rem' }}>Not returned by this Sonarr build</Typography>
              )}
            </Box>
          ))}
        </Box>
      </Panel>

      <Panel t={t} sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, md: 2 }, pb: 1 }}>
          <SectionTitle
            title="API collection coverage"
            detail={`${snapshot.insights.collection.healthyEndpointCount}/${snapshot.insights.collection.endpointCount} collected sources succeeded. Per-series episode and file reads are summarized as one source.`}
            t={t}
          />
          <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '22px minmax(150px, 0.55fr) minmax(220px, 1fr) 80px 80px', gap: 1, px: 2, pb: 0.5 }}>
            {['', 'Dataset', 'Endpoint', 'Rows', 'Latency'].map((label) => (
              <Typography key={label} sx={{ color: t.muted, fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: label === 'Rows' || label === 'Latency' ? 'right' : 'left' }}>{label}</Typography>
            ))}
          </Box>
        </Box>
        <Box sx={{ maxHeight: 640, overflowY: 'auto' }}>
          {diagnostics.map((item) => <DiagnosticRow key={`${item.key}-${item.path}`} item={item} t={t} isDark={isDark} />)}
        </Box>
      </Panel>
    </Box>
  );
}
