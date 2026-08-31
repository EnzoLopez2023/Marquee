import express from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth/serviceTokens.js', () => ({
  requireWatchtower: () => (_req: any, _res: any, next: any) => next(),
  requireWorkload: () => (_req: any, _res: any, next: any) => next(),
}))

const mocks = vi.hoisted(() => ({
  plexJson: vi.fn(),
  plexFetch: vi.fn(),
}))
vi.mock('../../server/clients/plex.js', () => mocks)
const { plexJson, plexFetch } = mocks

import { createContractsV1Router } from '../../server/routes/contractsV1.js'
import { temporaryDatabase, withServer } from '../helpers.js'

describe('Prism confirmed mutations', () => {
  beforeEach(() => vi.resetAllMocks())

  it('requires a verified prepare intent, exact phrase, and idempotency key', async () => {
    plexJson
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: '1', title: 'One', librarySectionID: '9' }] } })
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: '2', title: 'Two', librarySectionID: '9' }] } })
      .mockResolvedValueOnce({ MediaContainer: { machineIdentifier: 'machine' } })
    plexFetch
      .mockResolvedValueOnce(new Response('<Playlist ratingKey="99"/>', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        const prepare = await fetch(`${url}/api/contracts/v1/playlists/prepare`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer workload-test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Test', sectionId: '9', ratingKeys: ['1', '2'] }),
        })
        expect(prepare.status).toBe(200)
        const intent = await prepare.json() as any
        const missingKey = await fetch(`${url}/api/contracts/v1/playlists/commit`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer workload-test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            intentId: intent.intentId,
            confirmation: intent.confirmationPhrase,
          }),
        })
        expect(missingKey.status).toBe(400)
        const commit = () => fetch(`${url}/api/contracts/v1/playlists/commit`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer prism-test-token',
            'Content-Type': 'application/json',
            'Idempotency-Key': 'key-1',
          },
          body: JSON.stringify({
            intentId: intent.intentId,
            confirmation: intent.confirmationPhrase,
          }),
        })
        const first = await commit()
        expect(first.status).toBe(200)
        expect((await first.json() as any).id).toBe('99')
        const replay = await commit()
        expect(replay.status).toBe(200)
        expect((await replay.json() as any).id).toBe('99')
        expect(plexFetch).toHaveBeenCalledTimes(2)
      })
    } finally {
      handle.cleanup()
    }
  })

  it('rejects hostile section and media IDs before Plex verification', async () => {
    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        const response = await fetch(`${url}/api/contracts/v1/playlists/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Unsafe',
            sectionId: '9/../1',
            ratingKeys: ['1?X-Plex-Token=stolen'],
          }),
        })
        expect(response.status).toBe(400)
        expect(plexJson).not.toHaveBeenCalled()
        expect(plexFetch).not.toHaveBeenCalled()
      })
    } finally {
      handle.cleanup()
    }
  })

  it('converts a recovered executing intent to an unknown outcome without replay', async () => {
    plexJson.mockResolvedValueOnce({
      MediaContainer: { Metadata: [{ ratingKey: '1', title: 'One', librarySectionID: '9' }] },
    })
    const handle = temporaryDatabase()
    const app = express().use(express.json()).use(createContractsV1Router(handle.db))
    try {
      await withServer(app, async (url) => {
        const prepare = await fetch(`${url}/api/contracts/v1/playlists/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test', sectionId: '9', ratingKeys: ['1'] }),
        })
        const intent = await prepare.json() as any
        handle.db.prepare(`
          UPDATE contract_mutation_intents
          SET status = 'executing', idempotency_key = 'replay-key'
          WHERE id = ?
        `).run(intent.intentId)
        const replay = await fetch(`${url}/api/contracts/v1/playlists/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-key' },
          body: JSON.stringify({
            intentId: intent.intentId,
            confirmation: intent.confirmationPhrase,
          }),
        })
        expect(replay.status).toBe(409)
        expect((await replay.json() as any).error.code).toBe('OUTCOME_UNKNOWN')
        expect((handle.db.prepare(
          'SELECT status FROM contract_mutation_intents WHERE id = ?',
        ).get(intent.intentId) as any).status).toBe('unknown')
        expect(plexFetch).not.toHaveBeenCalled()
      })
    } finally {
      handle.cleanup()
    }
  })

  it('reconciles executing intents to unknown when the contract router starts', () => {
    const handle = temporaryDatabase()
    try {
      handle.db.prepare(`
        INSERT INTO contract_mutation_intents(
          id, consumer, operation, payload_hash, payload_json, confirmation_phrase,
          status, created_at, expires_at, idempotency_key
        ) VALUES ('crashed', 'prism', 'playlist', 'hash', '{}', 'CONFIRM',
                  'executing', 1, 2, 'key')
      `).run()
      createContractsV1Router(handle.db)
      expect((handle.db.prepare(
        "SELECT status FROM contract_mutation_intents WHERE id = 'crashed'",
      ).get() as any).status).toBe('unknown')
    } finally {
      handle.cleanup()
    }
  })
})
