import { config } from '../config.js'
import { sanitizeMediaPaths } from '../domain/media/sanitize.js'

export async function tautulliApi<T = any>(
  command: string,
  parameters: Record<string, string | number | boolean> = {},
): Promise<T> {
  if (!config.tautulli.apiKey) throw new Error('Tautulli is not configured')
  const url = new URL('/api/v2', config.tautulli.url)
  url.searchParams.set('apikey', config.tautulli.apiKey)
  url.searchParams.set('cmd', command)
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Tautulli request failed with status ${response.status}`)
  const json = await response.json() as {
    response?: { result?: string; message?: string; data?: T }
  }
  if (json.response?.result !== 'success') {
    throw new Error(json.response?.message || 'Tautulli rejected the request')
  }
  return sanitizeMediaPaths(json.response.data) as T
}
