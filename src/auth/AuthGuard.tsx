import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { CircularProgress, Stack, Typography } from '@mui/material';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { getLoginRequest } from './msalConfig';
import LandingPage from '../marketing/LandingPage';

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
  return <LandingPage onSignIn={() => void instance.loginRedirect(getLoginRequest())} />;
}
