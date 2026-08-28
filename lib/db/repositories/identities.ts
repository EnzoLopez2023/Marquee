import type Database from 'better-sqlite3'

export type AppRole = 'viewer' | 'duplicate_delete' | 'admin'

export interface Identity {
  tenantId: string
  oid: string
  email: string | null
  name: string | null
}

export class IdentityRepository {
  constructor(private readonly db: Database.Database) {}

  async touch(identity: Identity): Promise<void> {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO app_identities(
        tenant_id, oid, email_snapshot, display_name_snapshot, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, oid) DO UPDATE SET
        email_snapshot = excluded.email_snapshot,
        display_name_snapshot = excluded.display_name_snapshot,
        last_seen_at = excluded.last_seen_at
    `).run(identity.tenantId, identity.oid, identity.email, identity.name, now, now)
  }

  async roles(identity: Pick<Identity, 'tenantId' | 'oid'>): Promise<AppRole[]> {
    return (this.db.prepare(`
      SELECT role FROM app_role_grants WHERE tenant_id = ? AND oid = ? ORDER BY role
    `).all(identity.tenantId, identity.oid) as Array<{ role: AppRole }>).map((row) => row.role)
  }

  async ensureRole(
    identity: Pick<Identity, 'tenantId' | 'oid'>,
    role: AppRole,
  ): Promise<boolean> {
    return this.db.transaction(() => this.ensureRoleInTransaction(identity, role))()
  }

  ensureRoleInTransaction(
    identity: Pick<Identity, 'tenantId' | 'oid'>,
    role: AppRole,
  ): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO app_role_grants(
        tenant_id, oid, role, granted_at, granted_by_tenant_id, granted_by_oid
      ) VALUES (?, ?, ?, ?, NULL, NULL)
    `).run(identity.tenantId, identity.oid, role, Date.now())
    return result.changes === 1
  }

  async features(identity: Pick<Identity, 'tenantId' | 'oid'>) {
    const rows = this.db.prepare(`
      SELECT feature, can_edit, is_hidden FROM app_feature_permissions
      WHERE tenant_id = ? AND oid = ?
    `).all(identity.tenantId, identity.oid) as Array<{
      feature: string
      can_edit: number
      is_hidden: number
    }>
    return Object.fromEntries(rows.map((row) => [
      row.feature,
      { canEdit: Boolean(row.can_edit), isHidden: Boolean(row.is_hidden) },
    ]))
  }

  async replaceRoles(
    identity: Pick<Identity, 'tenantId' | 'oid'>,
    roles: AppRole[],
    actor: Pick<Identity, 'tenantId' | 'oid'>,
  ): Promise<void> {
    const replace = this.db.transaction(() => {
      this.replaceRolesInTransaction(identity, roles, actor)
    })
    replace()
  }

  replaceRolesInTransaction(
    identity: Pick<Identity, 'tenantId' | 'oid'>,
    roles: AppRole[],
    actor: Pick<Identity, 'tenantId' | 'oid'>,
  ): void {
    this.db.prepare('DELETE FROM app_role_grants WHERE tenant_id = ? AND oid = ?')
      .run(identity.tenantId, identity.oid)
    const insert = this.db.prepare(`
      INSERT INTO app_role_grants(
        tenant_id, oid, role, granted_at, granted_by_tenant_id, granted_by_oid
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const now = Date.now()
    for (const role of roles) {
      insert.run(identity.tenantId, identity.oid, role, now, actor.tenantId, actor.oid)
    }
  }

  async list() {
    return this.db.prepare(`
      SELECT i.tenant_id, i.oid, i.email_snapshot, i.display_name_snapshot,
             i.first_seen_at, i.last_seen_at,
             GROUP_CONCAT(r.role) AS roles
      FROM app_identities i
      LEFT JOIN app_role_grants r ON r.tenant_id = i.tenant_id AND r.oid = i.oid
      GROUP BY i.tenant_id, i.oid
      ORDER BY i.last_seen_at DESC
    `).all()
  }
}
