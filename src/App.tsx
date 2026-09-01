import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Avatar, Box, Button, CircularProgress, CssBaseline, Drawer, IconButton, List, ListItemButton, ListItemText, Skeleton, Stack, ThemeProvider, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useMsal } from '@azure/msal-react';
import { useThemeMode } from './context/ThemeContext';
import { useUserPermissions } from './context/UserPermissionsContext';
import { fetchAppVersion } from './services/appVersion';
import { raisedCardShadow } from './theme/elevation';
import { createIosTheme } from './theme/iosTheme';

const PlexLibrary = lazy(() => import('./PlexMovieInsights'));
const PlexCommandCenter = lazy(() => import('./PlexCommandCenter'));
const Sonarr = lazy(() => import('./SonarrDashboard'));
const AdminPage = lazy(() => import('./AdminPage'));

const SIDEBAR_WIDTH = 248;
const SIDEBAR_INSET = 16;
const SIDEBAR_RADIUS = 20;

const sidebarSurfaceSx = {
  boxSizing: 'border-box',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: SIDEBAR_RADIUS,
  boxShadow: (theme: Theme) => raisedCardShadow(theme.palette.mode === 'dark'),
  overflow: 'hidden',
} as const;

const NAV = [
  { to: '/plex/library', label: 'Library', feature: 'plex-library' },
  { to: '/plex/command-center', label: 'Command center', feature: 'plex-command-center' },
  { to: '/sonarr', label: 'Sonarr', feature: 'sonarr-dashboard' },
  { to: '/admin', label: 'Admin' },
  { to: '/settings', label: 'Settings' },
] as const;

function RouteFallback() {
  return <Stack minHeight="55vh" alignItems="center" justifyContent="center"><CircularProgress /></Stack>;
}

function MenuGlyph() {
  return <Box component="svg" viewBox="0 0 24 24" sx={{ width: 22, height: 22 }} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
  </Box>;
}

type AppVersionState =
  | { status: 'loading' }
  | { status: 'ready'; version: string }
  | { status: 'error' };

function accountInitials(label: string) {
  const value = label.includes('@') ? label.split('@')[0] : label;
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'M';
}

function SidebarContent({
  appVersion,
  onNavigate,
}: {
  appVersion: AppVersionState;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const { isHidden } = useUserPermissions();
  const { mode, toggleMode } = useThemeMode();
  const { accounts, instance } = useMsal();
  const [signOutState, setSignOutState] = useState<'idle' | 'pending' | 'error'>('idle');
  const items = NAV.filter(n => !('feature' in n) || !isHidden(n.feature));
  const account = instance.getActiveAccount() ?? accounts[0];
  const username = account?.username.trim() ?? '';
  const displayName = account?.name?.trim() || username || 'Signed in';
  const accountDetail = username && username !== displayName ? username : null;
  const signOut = async () => {
    if (signOutState === 'pending') return;
    setSignOutState('pending');
    try {
      await instance.logoutRedirect({
        ...(account ? { account } : {}),
        postLogoutRedirectUri: window.location.origin,
      });
    } catch {
      setSignOutState('error');
    }
  };
  return (
    <Stack sx={{ height: '100%', px: 1.5, py: 2 }}>
      <Typography
        component={Link}
        to="/plex/library"
        onClick={onNavigate}
        sx={{ px: 1.25, pb: 1, fontWeight: 850, fontSize: 20, letterSpacing: '-0.02em', color: 'text.primary', textDecoration: 'none' }}
      >
        Marquee
      </Typography>
      <List sx={{ py: 1, '& .MuiListItemButton-root': { flexGrow: 0, mb: 0.25 } }}>
        {items.map(n => {
          const selected = location.pathname === n.to || location.pathname.startsWith(`${n.to}/`);
          return (
            <ListItemButton key={n.to} component={Link} to={n.to} selected={selected} onClick={onNavigate}>
              <ListItemText primary={n.label} slotProps={{ primary: { fontSize: 15, fontWeight: selected ? 700 : 500 } }} />
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ flexGrow: 1 }} />
      <List sx={{ py: 0, '& .MuiListItemButton-root': { flexGrow: 0 } }}>
        <ListItemButton onClick={() => toggleMode()}>
          <ListItemText primary={mode === 'dark' ? 'Light appearance' : 'Dark appearance'} slotProps={{ primary: { fontSize: 14, color: 'text.secondary' } }} />
        </ListItemButton>
      </List>
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mx: 0.25, mt: 1, pt: 1.25 }}>
        <Stack
          aria-label="Signed-in account"
          direction="row"
          spacing={1.1}
          sx={{ alignItems: 'center', minWidth: 0, px: 1, py: 0.5 }}
        >
          <Avatar
            aria-hidden
            sx={{
              bgcolor: 'action.selected',
              color: 'primary.main',
              fontSize: 12,
              fontWeight: 800,
              height: 32,
              width: 32,
            }}
          >
            {accountInitials(displayName)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              title={displayName}
              sx={{ color: 'text.primary', fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}
            >
              {displayName}
            </Typography>
            {accountDetail && <Typography
              noWrap
              title={accountDetail}
              sx={{ color: 'text.secondary', fontSize: 11.5, lineHeight: 1.35, mt: 0.15 }}
            >
              {accountDetail}
            </Typography>}
          </Box>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 30, px: 1 }}>
          <Button
            aria-label={`Sign out ${displayName}`}
            disabled={signOutState === 'pending'}
            onClick={() => void signOut()}
            size="small"
            sx={{
              color: signOutState === 'error' ? 'error.main' : 'text.secondary',
              fontSize: 12,
              justifyContent: 'flex-start',
              minWidth: 0,
              px: 0,
              '&:hover': { bgcolor: 'transparent', color: 'text.primary' },
            }}
            variant="text"
          >
            {signOutState === 'pending' && <CircularProgress color="inherit" size={12} sx={{ mr: 0.75 }} />}
            {signOutState === 'error' ? 'Try sign out again' : signOutState === 'pending' ? 'Signing out' : 'Sign out'}
          </Button>
          {appVersion.status === 'loading'
            ? <Skeleton aria-label="Loading app version" width={54} />
            : <Typography
                title={appVersion.status === 'ready' ? `Marquee ${appVersion.version}` : 'App version unavailable'}
                sx={{
                  color: appVersion.status === 'error' ? 'error.main' : 'text.secondary',
                  fontSize: 11,
                  lineHeight: 1.2,
                  maxWidth: 104,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {appVersion.status === 'ready' ? `v${appVersion.version}` : 'Version unavailable'}
              </Typography>}
        </Stack>
      </Box>
    </Stack>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<AppVersionState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    fetchAppVersion()
      .then(version => {
        if (active) setAppVersion({ status: 'ready', version });
      })
      .catch(() => {
        if (active) setAppVersion({ status: 'error' });
      });
    return () => { active = false; };
  }, []);
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: SIDEBAR_WIDTH + SIDEBAR_INSET * 2,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            ...sidebarSurfaceSx,
            width: SIDEBAR_WIDTH,
            top: SIDEBAR_INSET,
            bottom: SIDEBAR_INSET,
            left: SIDEBAR_INSET,
            height: 'auto',
          },
        }}
      >
        <SidebarContent appVersion={appVersion} />
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            ...sidebarSurfaceSx,
            width: `min(${SIDEBAR_WIDTH}px, calc(100vw - ${SIDEBAR_INSET * 2}px))`,
            top: SIDEBAR_INSET,
            bottom: SIDEBAR_INSET,
            left: SIDEBAR_INSET,
            height: 'auto',
          },
        }}
      >
        <SidebarContent appVersion={appVersion} onNavigate={() => setMobileOpen(false)} />
      </Drawer>
      <IconButton
        aria-label="Open navigation"
        onClick={() => setMobileOpen(true)}
        sx={{
          display: { xs: mobileOpen ? 'none' : 'inline-flex', md: 'none' },
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: theme => theme.zIndex.drawer + 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: 3,
          borderRadius: '12px',
        }}
      >
        <MenuGlyph />
      </IconButton>
      <Box component="main" sx={{ flex: 1, minWidth: 0, pt: { xs: 6, md: 0 } }}>
        {children}
      </Box>
    </Box>
  );
}

function Settings() {
  const { mode, toggleMode } = useThemeMode();
  return <Box sx={{ maxWidth: 760, mx: 'auto', py: 5, px: 3 }}><Typography variant="h4" fontWeight={800}>Settings</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>Choose the workspace appearance saved on this device.</Typography><Button variant="contained" onClick={toggleMode}>Use {mode === 'dark' ? 'light' : 'dark'} theme</Button></Box>;
}

function Application() {
  const { mode } = useThemeMode();
  const theme = useMemo(() => createIosTheme(mode), [mode]);

  return <ThemeProvider theme={theme}><CssBaseline />
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/plex/library" element={<PlexLibrary />} />
          <Route path="/plex/command-center" element={<PlexCommandCenter />} />
          <Route path="/sonarr" element={<Sonarr />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/plex/library" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  </ThemeProvider>;
}

export default Application;
