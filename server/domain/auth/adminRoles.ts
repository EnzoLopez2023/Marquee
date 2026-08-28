import type Database from 'better-sqlite3'

export class LastAdminRequiredError extends Error {
  readonly code = 'LAST_ADMIN_REQUIRED'

  constructor() {
    super('At least one administrator grant must remain')
  }
}

export function assertAdminGrantRemains(db: Database.Database) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM app_role_grants WHERE role = 'admin'
  `).get() as { count: number }
  if (row.count < 1) throw new LastAdminRequiredError()
}
