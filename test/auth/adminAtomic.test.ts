import express from 'express'
import { describe, expect, it } from 'vitest'
import { createRepositories } from '../../lib/db/repositories/index.js'
import { createAdminRouter } from '../../server/routes/admin.js'
import { temporaryDatabase, withServer } from '../helpers.js'

const actor = {
  tenantId: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
  oid: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.test',
  name: 'Admin',
}
const target = {
  tenantId: actor.tenantId,
  oid: '22222222-2222-4222-8222-222222222222',
}

describe('atomic admin role changes', () => {
  it('rolls role replacement back when authoritative audit insertion fails', async () => {
    const handle = temporaryDatabase()
    const repositories = createRepositories(handle.db)
    const now = Date.now()
    handle.db.prepare(`
      INSERT INTO app_identities(
        tenant_id, oid, email_snapshot, display_name_snapshot, first_seen_at, last_seen_at
      ) VALUES (?, ?, NULL, NULL, ?, ?), (?, ?, NULL, NULL, ?, ?)
    `).run(actor.tenantId, actor.oid, now, now, target.tenantId, target.oid, now, now)
    handle.db.prepare(`
      INSERT INTO app_role_grants(tenant_id, oid, role, granted_at)
      VALUES (?, ?, 'viewer', ?)
    `).run(target.tenantId, target.oid, now)
    handle.db.exec(`
      CREATE TRIGGER reject_admin_audit
      BEFORE INSERT ON app_audit_log
      WHEN NEW.action = 'Updated Marquee roles'
      BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;
    `)
    const app = express()
      .use(express.json())
      .use((req, _res, next) => { req.identity = actor; req.roles = ['admin']; next() })
      .use(createAdminRouter(handle.db, repositories, (_req, _res, next) => next()))
    try {
      await withServer(app, async (url) => {
        const response = await fetch(
          `${url}/api/admin/users/${target.tenantId}/${target.oid}/roles`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roles: ['duplicate_delete'] }),
          },
        )
        expect(response.status).toBe(500)
        expect(handle.db.prepare(`
          SELECT role FROM app_role_grants WHERE tenant_id = ? AND oid = ?
        `).all(target.tenantId, target.oid)).toEqual([{ role: 'viewer' }])
        expect((handle.db.prepare('SELECT COUNT(*) AS n FROM app_audit_log').get() as any).n)
          .toBe(0)
      })
    } finally {
      handle.cleanup()
    }
  })
})
