import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import AuthGuard from './auth/AuthGuard';
import { createMsalSettings } from './auth/msalConfig';
import { fetchBrowserRuntimeConfig } from './auth/runtimeConfig';
import { ThemeModeProvider } from './context/ThemeContext';
import { UserPermissionsProvider } from './context/UserPermissionsContext';
import { setAccessTokenProvider } from './services/apiClient';

const root = createRoot(document.getElementById('root')!);

function AuthUnavailable() {
  return <main style={{
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, sans-serif',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
    textAlign: 'center',
  }}>
    <h1>Marquee</h1>
    <p>Sign-in is not available because the Marquee identity integration is not configured.</p>
    <code>USER_LOGIN_NOT_CONFIGURED</code>
  </main>;
}

async function start() {
  let runtimeConfig;
  try {
    runtimeConfig = await fetchBrowserRuntimeConfig();
  } catch {
    root.render(<StrictMode><AuthUnavailable /></StrictMode>);
    return;
  }
  const { msalConfig, loginRequest } = createMsalSettings(runtimeConfig);
  const msal = new PublicClientApplication(msalConfig);
  await msal.initialize();
  setAccessTokenProvider(async () => {
    const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
    if (!account) return undefined;
    return (await msal.acquireTokenSilent({ ...loginRequest, account })).accessToken;
  });

  root.render(<StrictMode><MsalProvider instance={msal}>
      <ThemeModeProvider>
        <AuthGuard>
          <UserPermissionsProvider>
            <BrowserRouter><App /></BrowserRouter>
          </UserPermissionsProvider>
        </AuthGuard>
      </ThemeModeProvider>
    </MsalProvider></StrictMode>);
}

void start();
