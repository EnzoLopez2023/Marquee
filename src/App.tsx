import { lazy, Suspense, useMemo } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppBar, Box, Button, CircularProgress, CssBaseline, Stack, ThemeProvider, Toolbar, Typography, createTheme } from '@mui/material';
import { useThemeMode } from './context/ThemeContext';
import { useUserPermissions } from './context/UserPermissionsContext';

const PlexLibrary = lazy(() => import('./PlexMovieInsights'));
const PlexCommandCenter = lazy(() => import('./PlexCommandCenter'));
const Sonarr = lazy(() => import('./SonarrDashboard'));
const AdminPage = lazy(() => import('./AdminPage'));

function RouteFallback() {
  return <Stack minHeight="55vh" alignItems="center" justifyContent="center"><CircularProgress /></Stack>;
}

function Settings() {
  const { mode, toggleMode } = useThemeMode();
  return <Box sx={{ maxWidth: 760, mx: 'auto', py: 5, px: 3 }}><Typography variant="h4" fontWeight={800}>Settings</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>Choose the workspace appearance saved on this device.</Typography><Button variant="contained" onClick={toggleMode}>Use {mode === 'dark' ? 'light' : 'dark'} theme</Button></Box>;
}

function Application() {
  const { mode } = useThemeMode();
  const location = useLocation();
  const { isHidden } = useUserPermissions();
  const theme = useMemo(() => createTheme({
    palette: { mode, primary: { main: mode === 'dark' ? '#f59e6c' : '#b94e29' }, background: { default: mode === 'dark' ? '#111827' : '#f5f7fa', paper: mode === 'dark' ? '#182234' : '#fff' } },
    shape: { borderRadius: 12 },
    typography: { fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  }), [mode]);

  const title = location.pathname.startsWith('/sonarr') ? 'Sonarr' : location.pathname.startsWith('/admin') ? 'Admin' : 'Marquee';
  return <ThemeProvider theme={theme}><CssBaseline />
    <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', backdropFilter: 'blur(12px)' }}>
      <Toolbar sx={{ gap: 1, flexWrap: 'wrap', py: .5 }}>
        <Typography component={Link} to="/plex/library" variant="h6" color="text.primary" fontWeight={850} sx={{ textDecoration: 'none', mr: { sm: 2 } }}>Marquee</Typography>
        {!isHidden('plex-library') && <Button component={Link} to="/plex/library" color="inherit">Library</Button>}
        {!isHidden('plex-command-center') && <Button component={Link} to="/plex/command-center" color="inherit">Command center</Button>}
        {!isHidden('sonarr-dashboard') && <Button component={Link} to="/sonarr" color="inherit">Sonarr</Button>}
        <Button component={Link} to="/admin" color="inherit">Admin</Button>
        <Button component={Link} to="/settings" color="inherit">Settings</Button>
        <Typography color="text.secondary" sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>{title}</Typography>
      </Toolbar>
    </AppBar>
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
  </ThemeProvider>;
}

export default Application;
