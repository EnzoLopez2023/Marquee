import { lazy, Suspense, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Box, Button, CircularProgress, CssBaseline, Drawer, IconButton, List, ListItemButton, ListItemText, Stack, ThemeProvider, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useThemeMode } from './context/ThemeContext';
import { useUserPermissions } from './context/UserPermissionsContext';
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { isHidden } = useUserPermissions();
  const { mode, toggleMode } = useThemeMode();
  const items = NAV.filter(n => !('feature' in n) || !isHidden(n.feature));
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
    </Stack>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
        <SidebarContent />
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
        <SidebarContent onNavigate={() => setMobileOpen(false)} />
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
