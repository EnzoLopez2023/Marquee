import type Database from 'better-sqlite3'
import { AuditRepository } from './audit.js'
import { IdentityRepository } from './identities.js'
import { ProviderHealthRepository } from './providerHealth.js'

export function createRepositories(db: Database.Database) {
  return {
    audit: new AuditRepository(db),
    identities: new IdentityRepository(db),
    providerHealth: new ProviderHealthRepository(db),
    transaction<T>(work: () => T): T {
      return db.transaction(work)()
    },
  }
}

export type Repositories = ReturnType<typeof createRepositories>
