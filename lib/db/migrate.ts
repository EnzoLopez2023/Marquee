import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import * as initial from './migrations/001_initial.js'
import * as featurePermissions from './migrations/002_feature_permissions.js'

const migrations = [initial, featurePermissions]
export const SCHEMA_VERSION = migrations.at(-1)!.version

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex')
export const MIGRATION_IDENTITIES = migrations.map((migration) => ({
  version: migration.version,
  name: migration.name,
  checksum: checksum(migration.sql),
}))

export function assertExactMigrationIdentity(db: Database.Database): void {
  const actual = db.prepare(`
    SELECT version, name, checksum FROM schema_migrations ORDER BY version
  `).all()
  if (JSON.stringify(actual) !== JSON.stringify(MIGRATION_IDENTITIES)) {
    throw new Error('Marquee migration identity is incomplete or contains unexpected rows')
  }
}

export function migrate(db: Database.Database): void {
  const hasMigrations = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get()
  if (!hasMigrations) {
    const apply = db.transaction(() => {
      db.exec(initial.sql)
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(initial.version, initial.name, checksum(initial.sql), Date.now())
    })
    apply()
  }

  for (const migration of migrations) {
    const row = db.prepare(
    'SELECT name, checksum FROM schema_migrations WHERE version = ?',
    ).get(migration.version) as { name: string; checksum: string } | undefined
    if (row) {
      if (row.name !== migration.name || row.checksum !== checksum(migration.sql)) {
        throw new Error(`Marquee schema migration ${migration.version} has an invalid checksum`)
      }
      continue
    }
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, checksum(migration.sql), Date.now())
    })()
  }
  assertExactMigrationIdentity(db)
}
