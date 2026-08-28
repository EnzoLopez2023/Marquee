import { config } from '../config.js'

export async function playlistCompletion(messages: Array<{ role: string; content: string }>) {
  const { endpoint, apiKey, deployment } = config.playlistModel
  if (!endpoint || !apiKey) throw new Error('Playlist model is not configured')
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: deployment, messages }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Playlist model failed with status ${response.status}`)
  return response.json() as Promise<any>
}
