import type { Configuration } from '@azure/msal-browser';
import type { MarqueeRuntimeConfig } from './runtimeConfig.js';

let activeLoginRequest: { scopes: string[] } | null = null;

export function createMsalSettings(runtimeConfig: MarqueeRuntimeConfig) {
  const msalConfig: Configuration = {
    auth: {
      clientId: runtimeConfig.entraClientId,
      authority: `https://login.microsoftonline.com/${runtimeConfig.entraTenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
  };
  activeLoginRequest = { scopes: [runtimeConfig.entraApiScope] };
  return {
    msalConfig,
    loginRequest: activeLoginRequest,
  };
}

export function getLoginRequest() {
  if (!activeLoginRequest) throw new Error('MSAL runtime configuration is not initialized');
  return activeLoginRequest;
}
