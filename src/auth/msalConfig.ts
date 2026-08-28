import type { Configuration } from '@azure/msal-browser';
import { readBrowserRuntimeConfig } from './runtimeConfig.js';

const runtimeConfig = readBrowserRuntimeConfig();
const tenantId = runtimeConfig.entraTenantId;
const clientId = runtimeConfig.entraClientId;

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? '',
    authority: `https://login.microsoftonline.com/${tenantId ?? ''}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
};

export const loginRequest = {
  scopes: [runtimeConfig.entraApiScope],
};
