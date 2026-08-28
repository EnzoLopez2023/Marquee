import { config } from '../config.js'

export async function movieDetails(title: string, year?: string) {
  if (!config.omdbApiKey) throw new Error('OMDb is not configured')
  const url = new URL('https://www.omdbapi.com/')
  url.searchParams.set('apikey', config.omdbApiKey)
  url.searchParams.set('t', title)
  url.searchParams.set('plot', 'full')
  if (year) url.searchParams.set('y', year)
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`OMDb request failed with status ${response.status}`)
  return response.json() as Promise<Record<string, string>>
}
