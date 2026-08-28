import { describe, expect, it } from 'vitest'
import {
  canonicalLegacyOid,
  targetTransformEvidence,
  verifyTargetTransformEvidence,
} from '../../scripts/importSupport.mjs'
import { temporaryDatabase } from '../helpers.js'

describe('import transform evidence', () => {
  it('canonicalizes mixed-case legacy OIDs before key construction', () => {
    expect(canonicalLegacyOid('11111111-AAAA-4BBB-8CCC-111111111111'))
      .toBe('11111111-aaaa-4bbb-8ccc-111111111111')
  })

  it('rejects transformed target drift before import success', () => {
    const handle = temporaryDatabase()
    try {
      const now = 1
      handle.db.prepare(`
        INSERT INTO app_identities(
          tenant_id, oid, email_snapshot, display_name_snapshot, first_seen_at, last_seen_at
        ) VALUES ('tenant', 'oid', 'before@example.test', 'Before', ?, ?)
      `).run(now, now)
      const transforms = targetTransformEvidence(handle.db)
      const manifest = { evidence: { transforms } } as any
      expect(() => verifyTargetTransformEvidence(handle.db, manifest)).not.toThrow()
      handle.db.prepare(`
        UPDATE app_identities SET email_snapshot = 'after@example.test'
      `).run()
      expect(() => verifyTargetTransformEvidence(handle.db, manifest))
        .toThrow('Imported transform evidence mismatch')
    } finally {
      handle.cleanup()
    }
  })
})
