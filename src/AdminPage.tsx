import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import PlexUsers from './components/PlexUsers';
import { apiClient } from './services/apiClient';

interface AdminData {
  health?: {
    config: { providers: Record<string, boolean> };
    providers: Array<{ provider: string; status: string; observed_at: number }>;
  };
  audit?: { lines: Array<{ id: number; ts: number; action: string; detail?: string }> };
  users?: { users: Array<{ tenant_id: string; oid: string; email_snapshot?: string; roles?: string }> };
}

export default function AdminPage() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<AdminData>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<AdminData['health']>('/api/admin/health'),
      apiClient.get<AdminData['audit']>('/api/admin/audit?limit=100'),
      apiClient.get<AdminData['users']>('/api/admin/users'),
    ]).then(([health, audit, users]) => {
      if (active) setData({ health, audit, users });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Administration unavailable');
    });
    return () => { active = false; };
  }, []);

  return <Box sx={{ maxWidth: 1500, mx: 'auto', py: 3, px: { xs: 1.5, md: 3 } }}>
    <Typography variant="h4" fontWeight={800}>Administration</Typography>
    <Tabs value={tab} onChange={(_, value: number) => setTab(value)} sx={{ mb: 2 }}>
      <Tab label="Health" /><Tab label="Audit" /><Tab label="Plex users" />
    </Tabs>
    {error ? <Alert severity="error">{error}</Alert> : !data.health ? <CircularProgress /> : null}
    {tab === 0 && data.health && <Stack spacing={2}>
      <Card><CardContent>
        <Typography variant="h6" gutterBottom>Provider configuration</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {Object.entries(data.health.config.providers).map(([name, configured]) =>
            <Chip key={name} label={name} color={configured ? 'success' : 'default'} variant={configured ? 'filled' : 'outlined'} />)}
        </Stack>
      </CardContent></Card>
      <Card><CardContent>
        <Typography variant="h6" gutterBottom>Last observations</Typography>
        {data.health.providers.length === 0
          ? <Typography color="text.secondary">No provider probe has run yet.</Typography>
          : data.health.providers.map((provider) =>
            <Typography key={provider.provider}>{provider.provider}: {provider.status} - {new Date(provider.observed_at).toLocaleString()}</Typography>)}
      </CardContent></Card>
    </Stack>}
    {tab === 1 && <Card><CardContent>
      <Typography variant="h6" gutterBottom>App audit</Typography>
      {(data.audit?.lines ?? []).map((line) =>
        <Box key={line.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography fontWeight={700}>{line.action}</Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(line.ts).toLocaleString()} {line.detail ?? ''}
          </Typography>
        </Box>)}
    </CardContent></Card>}
    {tab === 2 && <PlexUsers />}
  </Box>;
}
