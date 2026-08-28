import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import * as initial from './migrations/001_initial.js'
import * as featurePermissions from './migrations/002_feature_permissions.js'

export interface SchemaObjectIdentity {
  type: 'table' | 'index' | 'trigger'
  name: string
  sqlSha256: string
}

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim()

export function schemaObjectManifest(db: Database.Database): SchemaObjectIdentity[] {
  const rows = db.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('table','index','trigger')
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY type, name
  `).all() as Array<{ type: SchemaObjectIdentity['type']; name: string; sql: string }>
  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    sqlSha256: createHash('sha256').update(normalizeSql(row.sql)).digest('hex'),
  }))
}

const expectedDatabase = new Database(':memory:')
expectedDatabase.exec(initial.sql)
expectedDatabase.exec(featurePermissions.sql)
export const EXPECTED_SCHEMA_OBJECTS = schemaObjectManifest(expectedDatabase)
expectedDatabase.close()

export function assertExactMarqueeSchema(db: Database.Database) {
  const actual = schemaObjectManifest(db)
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_SCHEMA_OBJECTS)) {
    throw new Error('Database has an invalid Marquee schema object manifest')
  }
  return actual
}
