export async function fetchAppVersion(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher('/api/version', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`App version request failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (
    !payload
    || typeof payload !== 'object'
    || typeof (payload as { version?: unknown }).version !== 'string'
    || !(payload as { version: string }).version.trim()
  ) {
    throw new Error('App version response is invalid');
  }
  return (payload as { version: string }).version.trim();
}
