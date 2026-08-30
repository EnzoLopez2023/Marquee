import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import AuthGuard from './auth/AuthGuard';
import { createMsalSettings } from './auth/msalConfig';
import { fetchBrowserRuntimeConfig } from './auth/runtimeConfig';
import { ThemeModeProvider } from './context/ThemeContext';
import { UserPermissionsProvider } from './context/UserPermissionsContext';
import { setAccessTokenProvider } from './services/apiClient';

registerSW({ immediate: true });

const root = createRoot(document.getElementById('root')!);

function AuthUnavailable() {
  return <main style={{
    alignItems: 'center',
    background:
      '#f5f7fa linear-gradient(#e5eaf2 1px, transparent 1px) 0 0 / 100% 32px,' +
      ' linear-gradient(90deg, #e5eaf2 1px, transparent 1px) 0 0 / 32px 100%',
    color: '#14213d',
    display: 'flex',
    flexDirection: 'column',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif",
    gap: '0.75rem',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
    textAlign: 'center',
  }}>
    <span style={{
      color: '#687891',
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: '0.72rem',
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
    }}>Marquee</span>
    <h1 style={{ fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
      Sign-in is <span style={{ color: '#b94e29' }}>not available</span>.
    </h1>
    <p style={{ color: '#40536d', maxWidth: 460, lineHeight: 1.6 }}>
      The Marquee identity integration is not configured on this deployment.
    </p>
    <code style={{
      background: 'rgba(185,78,41,0.10)',
      borderRadius: 10,
      color: '#92391e',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '0.8rem',
      padding: '0.4rem 0.7rem',
    }}>USER_LOGIN_NOT_CONFIGURED</code>
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
