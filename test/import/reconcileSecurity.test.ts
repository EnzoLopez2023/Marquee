import { describe, expect, it } from 'vitest'
import {
  canonicalRecordsHash,
  hasExactSchemaVersions,
} from '../../scripts/importSupport.mjs'

const fields = ['tenant_id', 'oid', 'feature', 'can_edit', 'is_hidden']
const source = [{
  tenant_id: 'tenant',
  oid: 'oid',
  feature: 'plex-library',
  can_edit: 0,
  is_hidden: 1,
}]

describe('security transformation reconciliation', () => {
  it('detects permission widening through canonical mapped hashes', () => {
    const expected = canonicalRecordsHash(source, fields, ['tenant_id', 'oid', 'feature'])
    const widened = canonicalRecordsHash([
      { ...source[0], can_edit: 1 },
    ], fields, ['tenant_id', 'oid', 'feature'])
    expect(widened.sha256).not.toBe(expected.sha256)
  })

  it('requires the exact migration set rather than a matching maximum', () => {
    expect(hasExactSchemaVersions([1, 2], [1, 2])).toBe(true)
    expect(hasExactSchemaVersions([2], [1, 2])).toBe(false)
    expect(hasExactSchemaVersions([1, 2, 3], [1, 2])).toBe(false)
  })
})
