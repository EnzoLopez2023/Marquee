export interface MarqueeRuntimeConfig {
  entraTenantId: string;
  entraClientId: string;
  entraAudience: string;
  entraApiScope: string;
}

export type RuntimeConfigErrorCode =
  | 'USER_LOGIN_NOT_CONFIGURED'
  | 'RUNTIME_CONFIG_UNAVAILABLE';

export class RuntimeConfigError extends Error {
  constructor(
    readonly code: RuntimeConfigErrorCode,
    readonly status?: number,
  ) {
    super(status
      ? `Marquee runtime configuration is unavailable (${status})`
      : 'Marquee runtime configuration is unavailable');
    this.name = 'RuntimeConfigError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateRuntimeConfig(value: unknown): MarqueeRuntimeConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Marquee runtime configuration is missing');
  }
  const candidate = value as Partial<MarqueeRuntimeConfig>;
  const tenantId = candidate.entraTenantId;
  const clientId = candidate.entraClientId;
  const audience = candidate.entraAudience;
  const apiScope = candidate.entraApiScope;
  if (
    typeof tenantId !== 'string'
    || typeof clientId !== 'string'
    || !GUID.test(tenantId)
    || !GUID.test(clientId)
  ) {
    throw new Error('Marquee runtime Entra tenant/client configuration is invalid');
  }
  const expectedScope = `api://${clientId}/Marquee.User`;
  if (audience !== clientId && audience !== `api://${clientId}`) {
    throw new Error('Marquee runtime Entra audience is invalid');
  }
  if (apiScope !== expectedScope) {
    throw new Error('Marquee runtime Entra scope is invalid');
  }
  return {
    entraTenantId: tenantId,
    entraClientId: clientId,
    entraAudience: audience,
    entraApiScope: apiScope,
  };
}

export async function fetchBrowserRuntimeConfig(
  fetcher: typeof fetch = fetch,
): Promise<MarqueeRuntimeConfig> {
  const response = await fetcher('/api/config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    if (
      response.status === 503
      && response.headers.get('content-type')?.toLowerCase().includes('application/json')
    ) {
      const body = await response.json() as {
        error?: { code?: unknown };
      };
      if (body.error?.code === 'USER_LOGIN_NOT_CONFIGURED') {
        throw new RuntimeConfigError('USER_LOGIN_NOT_CONFIGURED', response.status);
      }
    }
    throw new RuntimeConfigError('RUNTIME_CONFIG_UNAVAILABLE', response.status);
  }
  return validateRuntimeConfig(await response.json());
}
