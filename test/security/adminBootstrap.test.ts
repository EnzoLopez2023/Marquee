import { describe, expect, it } from 'vitest'
import { resolveAdminOid } from '../../server/config.js'

const admin = '11111111-1111-4111-8111-111111111111'

describe('production admin bootstrap', () => {
  it('requires one valid configured administrator', () => {
    expect(resolveAdminOid(admin, '', true)).toBe(admin)
    expect(resolveAdminOid('', admin, true)).toBe(admin)
    expect(() => resolveAdminOid('', '', true)).toThrow('requires ADMIN_OID')
    expect(() => resolveAdminOid('not-an-oid', admin, true)).toThrow('ADMIN_OID')
    expect(resolveAdminOid(admin.toUpperCase(), '', true)).toBe(admin)
  })
})
