export interface MarqueeRuntimeConfig {
  entraTenantId: string;
  entraClientId: string;
  entraApiScope: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateRuntimeConfig(value: unknown): MarqueeRuntimeConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Marquee runtime configuration is missing');
  }
  const candidate = value as Partial<MarqueeRuntimeConfig>;
  if (!GUID.test(candidate.entraTenantId ?? '') || !GUID.test(candidate.entraClientId ?? '')) {
    throw new Error('Marquee runtime Entra tenant/client configuration is invalid');
  }
  const expectedScope = `api://${candidate.entraClientId}/Marquee.User`;
  if (candidate.entraApiScope !== expectedScope) {
    throw new Error('Marquee runtime Entra scope is invalid');
  }
  return candidate as MarqueeRuntimeConfig;
}

declare global {
  interface Window {
    __MARQUEE_RUNTIME_CONFIG__?: MarqueeRuntimeConfig;
  }
}

export function readBrowserRuntimeConfig() {
  if (typeof window === 'undefined') throw new Error('Browser runtime configuration is unavailable');
  return validateRuntimeConfig(window.__MARQUEE_RUNTIME_CONFIG__);
}
