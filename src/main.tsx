import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import AuthGuard from './auth/AuthGuard';
import { msalConfig } from './auth/msalConfig';
import { loginRequest } from './auth/msalConfig';
import { ThemeModeProvider } from './context/ThemeContext';
import { UserPermissionsProvider } from './context/UserPermissionsContext';
import { setAccessTokenProvider } from './services/apiClient';

const msal = new PublicClientApplication(msalConfig);
await msal.initialize();
setAccessTokenProvider(async () => {
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) return undefined;
  return (await msal.acquireTokenSilent({ ...loginRequest, account })).accessToken;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MsalProvider instance={msal}>
      <ThemeModeProvider>
        <AuthGuard>
          <UserPermissionsProvider>
            <BrowserRouter><App /></BrowserRouter>
          </UserPermissionsProvider>
        </AuthGuard>
      </ThemeModeProvider>
    </MsalProvider>
  </StrictMode>,
);
