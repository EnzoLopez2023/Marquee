import { describe, expect, it } from 'vitest'
import {
  canDeleteDuplicates,
  featureIsReadOnly,
} from '../../src/auth/permissions.js'

describe('duplicate delete client authorization', () => {
  it('requires both feature edit and the destructive delete role', () => {
    expect(canDeleteDuplicates(true, true)).toBe(true)
    expect(canDeleteDuplicates(true, false)).toBe(false)
    expect(canDeleteDuplicates(false, true)).toBe(false)
    expect(canDeleteDuplicates(false, false)).toBe(false)
  })

  it('fails closed while permissions are unresolved', () => {
    expect(featureIsReadOnly({
      loading: true,
      duplicateFeature: true,
      hasDeleteRole: true,
      hasFeatureEdit: true,
    })).toBe(true)
    expect(featureIsReadOnly({
      loading: false,
      duplicateFeature: true,
      hasDeleteRole: true,
      hasFeatureEdit: true,
    })).toBe(false)
  })
})
