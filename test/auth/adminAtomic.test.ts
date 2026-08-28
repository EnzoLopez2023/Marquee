import express from 'express'
import type Database from 'better-sqlite3'
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
const otherAdmin = {
  tenantId: actor.tenantId,
  oid: '33333333-3333-4333-8333-333333333333',
}

const seedIdentity = (
  db: Database.Database,
  identity: { tenantId: string; oid: string },
) => {
  const now = Date.now()
  db.prepare(`
    INSERT OR IGNORE INTO app_identities(
      tenant_id, oid, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?)
  `).run(identity.tenantId, identity.oid, now, now)
}

const grant = (
  db: Database.Database,
  identity: { tenantId: string; oid: string },
  role: 'viewer' | 'duplicate_delete' | 'admin',
) => db.prepare(`
  INSERT INTO app_role_grants(tenant_id, oid, role, granted_at)
  VALUES (?, ?, ?, ?)
`).run(identity.tenantId, identity.oid, role, Date.now())

const adminApp = (
  handle: ReturnType<typeof temporaryDatabase>,
  requestActor = actor,
) => {
  const repositories = createRepositories(handle.db)
  return express()
    .use(express.json())
    .use((req, _res, next) => { req.identity = requestActor; req.roles = ['admin']; next() })
    .use(createAdminRouter(handle.db, repositories, (_req, _res, next) => next()))
}

describe('atomic admin role changes', () => {
  it('rolls configured-admin materialization back when its audit fails', () => {
    const handle = temporaryDatabase()
    const repositories = createRepositories(handle.db)
    seedIdentity(handle.db, actor)
    handle.db.exec(`
      CREATE TRIGGER reject_materialization_audit
      BEFORE INSERT ON app_audit_log
      WHEN NEW.action = 'Configured administrator grant materialized'
      BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;
    `)
    try {
      expect(() => repositories.transaction(() => {
        repositories.identities.ensureRoleInTransaction(actor, 'admin')
        repositories.audit.appendAuthoritativeInTransaction({
          category: 'auth',
          action: 'Configured administrator grant materialized',
        }, actor, null)
      })).toThrow('simulated audit failure')
      expect((handle.db.prepare(`
        SELECT COUNT(*) AS n FROM app_role_grants WHERE role = 'admin'
      `).get() as any).n).toBe(0)
      expect((handle.db.prepare('SELECT COUNT(*) AS n FROM app_audit_log').get() as any).n)
        .toBe(0)
    } finally {
      handle.cleanup()
    }
  })

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
    grant(handle.db, actor, 'admin')
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

  it('blocks last-admin self-removal and rolls every requested grant back', async () => {
    const handle = temporaryDatabase()
    seedIdentity(handle.db, actor)
    grant(handle.db, actor, 'admin')
    try {
      await withServer(adminApp(handle), async (url) => {
        const response = await fetch(
          `${url}/api/admin/users/${actor.tenantId}/${actor.oid}/roles`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roles: ['viewer', 'duplicate_delete'] }),
          },
        )
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
          error: { code: 'LAST_ADMIN_REQUIRED' },
        })
        expect(handle.db.prepare(`
          SELECT role FROM app_role_grants WHERE tenant_id = ? AND oid = ? ORDER BY role
        `).all(actor.tenantId, actor.oid)).toEqual([{ role: 'admin' }])
      })
    } finally {
      handle.cleanup()
    }
  })

  it('blocks another caller from removing the final persisted admin', async () => {
    const handle = temporaryDatabase()
    seedIdentity(handle.db, actor)
    seedIdentity(handle.db, target)
    grant(handle.db, target, 'admin')
    try {
      await withServer(adminApp(handle), async (url) => {
        const response = await fetch(
          `${url}/api/admin/users/${target.tenantId}/${target.oid}/roles`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roles: ['viewer'] }),
          },
        )
        expect(response.status).toBe(409)
        expect(handle.db.prepare(`
          SELECT role FROM app_role_grants WHERE tenant_id = ? AND oid = ?
        `).all(target.tenantId, target.oid)).toEqual([{ role: 'admin' }])
      })
    } finally {
      handle.cleanup()
    }
  })

  it('allows non-last admin removal and updates that retain admin', async () => {
    const handle = temporaryDatabase()
    for (const identity of [actor, target, otherAdmin]) seedIdentity(handle.db, identity)
    grant(handle.db, actor, 'admin')
    grant(handle.db, target, 'admin')
    try {
      await withServer(adminApp(handle), async (url) => {
        const remove = await fetch(
          `${url}/api/admin/users/${target.tenantId}/${target.oid}/roles`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roles: ['viewer'] }),
          },
        )
        expect(remove.status).toBe(200)
        const retain = await fetch(
          `${url}/api/admin/users/${actor.tenantId}/${actor.oid}/roles`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roles: ['admin', 'viewer'] }),
          },
        )
        expect(retain.status).toBe(200)
        expect(handle.db.prepare(`
          SELECT role FROM app_role_grants WHERE tenant_id = ? AND oid = ? ORDER BY role
        `).all(actor.tenantId, actor.oid)).toEqual([
          { role: 'admin' },
          { role: 'viewer' },
        ])
        expect((handle.db.prepare(
          "SELECT COUNT(*) AS n FROM app_audit_log WHERE action = 'Updated Marquee roles'",
        ).get() as any).n).toBe(2)
      })
    } finally {
      handle.cleanup()
    }
  })
})
