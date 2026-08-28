import type { DatabaseHandle } from '../db/connection.js'
import { SOURCE } from './buildIdentity.js'
import { assertExactMarqueeSchema } from '../db/schemaIdentity.js'
import { assertExactMigrationIdentity } from '../db/migrate.js'

export function liveness() {
  return { success: true, status: 'live', ...SOURCE }
}

export function readiness(handle: DatabaseHandle) {
  try {
    handle.db.prepare('SELECT 1 AS ok').get()
    handle.assertInstanceLease()
    const row = handle.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null
    }
    if (row.version !== handle.schemaVersion) {
      throw new Error('Schema version does not match the running build')
    }
    assertExactMarqueeSchema(handle.db)
    assertExactMigrationIdentity(handle.db)
    return {
      statusCode: 200,
      payload: {
        success: true,
        status: 'ready',
        ...SOURCE,
        database: {
          authority: handle.path,
          schemaVersion: handle.schemaVersion,
          journalMode: 'delete',
        },
      },
    }
  } catch (error) {
    return {
      statusCode: 503,
      payload: {
        success: false,
        status: 'not-ready',
        ...SOURCE,
        reason: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
