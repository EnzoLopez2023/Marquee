import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { withServer } from '../helpers.js'

const mocks = vi.hoisted(() => ({
  plexFetch: vi.fn(),
  playlistCompletion: vi.fn(),
}))
vi.mock('../../server/clients/plex.js', () => ({
  plexFetch: mocks.plexFetch,
  plexText: vi.fn(),
  plexJson: vi.fn(),
}))
vi.mock('../../server/clients/playlistModel.js', () => ({
  playlistCompletion: mocks.playlistCompletion,
}))

import playlistRouter from '../../server/routes/playlistCreator.js'

describe('playlist creator Plex identifiers', () => {
  it('rejects forged movie IDs before opening SSE or calling Plex', async () => {
    const app = express().use(express.json()).use(playlistRouter)
    await withServer(app, async (url) => {
      const response = await fetch(`${url}/api/playlist-creator/create-playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalQuery: 'Unsafe',
          movies: [{ title: 'Movie', ratingKey: '1/../../status' }],
        }),
      })
      expect(response.status).toBe(400)
      expect(mocks.plexFetch).not.toHaveBeenCalled()
      expect(mocks.playlistCompletion).not.toHaveBeenCalled()
    })
  })
})
