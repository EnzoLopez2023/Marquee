import express from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withServer } from '../helpers.js'

const mocks = vi.hoisted(() => ({
  plexJson: vi.fn(),
}))
vi.mock('../../server/clients/plex.js', () => ({
  plexJson: mocks.plexJson,
  plexDispatcher: {},
}))

import plexRouter from '../../server/routes/plex.js'

describe('Plex route identifier rejection', () => {
  beforeEach(() => mocks.plexJson.mockReset())

  it('rejects hostile route and body IDs before token-bearing dispatch', async () => {
    const app = express().use(express.json()).use(plexRouter)
    await withServer(app, async (url) => {
      const requests = [
        fetch(`${url}/api/plex/playlists/1%2F2/items`),
        fetch(`${url}/api/plex/collections/1%5C2`),
        fetch(`${url}/api/plex/sections/1%3Ftoken/all`),
        fetch(`${url}/api/plex/library/%2e%2e%2F1/playlists`),
        fetch(`${url}/api/plex/playlists/1%23fragment/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: 'library://item' }),
        }),
        fetch(`${url}/api/plex/collections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Unsafe', sectionId: '1/../2' }),
        }),
      ]
      const responses = await Promise.all(requests)
      expect(responses.map((response) => response.status)).toEqual(
        responses.map(() => 400),
      )
      expect(mocks.plexJson).not.toHaveBeenCalled()
    })
  })
})
