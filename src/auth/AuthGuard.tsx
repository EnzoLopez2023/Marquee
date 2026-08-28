import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from './msalConfig';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const authenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();

  useEffect(() => {
    const [account] = instance.getAllAccounts();
    if (!instance.getActiveAccount() && account) instance.setActiveAccount(account);
  }, [instance]);

  if (inProgress !== 'none') {
    return <Stack alignItems="center" justifyContent="center" minHeight="100vh" spacing={2}><CircularProgress /><Typography>Completing sign-in…</Typography></Stack>;
  }
  if (authenticated) return <>{children}</>;
  return <Stack alignItems="center" justifyContent="center" minHeight="100vh" spacing={2} sx={{ px: 2 }}>
    <Typography component="h1" variant="h4" fontWeight={800}>Marquee</Typography>
    <Typography color="text.secondary" textAlign="center">Sign in to access your media operations.</Typography>
    <Button variant="contained" onClick={() => void instance.loginRedirect(loginRequest)}>Sign in</Button>
  </Stack>;
}
