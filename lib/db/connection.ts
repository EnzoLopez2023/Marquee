import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../../server/config.js'
import { migrate, SCHEMA_VERSION } from './migrate.js'
import { assertExactMarqueeSchema } from './schemaIdentity.js'
import {
  acquireAuthorityTransitionLock,
  acquireInstanceLifetimeLock,
  canonicalAuthorityPath,
  type InstanceLifetimeLock,
} from './authorityTransitionLock.js'

export interface DatabaseHandle {
  db: Database.Database
  path: string
  schemaVersion: number
  instanceId: string
  instanceLeaseHealthy(): boolean
  assertInstanceLease(): void
  onInstanceLeaseLost(listener: () => void): () => void
  close(): void
}

const collectCleanupErrors = (actions: Array<() => void>) => {
  const errors: unknown[] = []
  for (const action of actions) {
    try {
      action()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

const throwWithCleanupErrors = (primary: unknown, cleanupErrors: unknown[]): never => {
  if (!cleanupErrors.length) throw primary
  throw new AggregateError(
    [primary, ...cleanupErrors],
    primary instanceof Error ? primary.message : 'Database startup failed',
  )
}

function databaseInstanceLeaseIsInactive(databasePath: string) {
  if (!existsSync(databasePath)) return true
  const inspection = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  })
  try {
    inspection.pragma(`busy_timeout = ${config.sqliteBusyTimeoutMs}`)
    const hasLeaseTable = inspection.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'runtime_instance_lease'
    `).get()
    if (!hasLeaseTable) return true
    const lease = inspection.prepare(`
      SELECT expires_at FROM runtime_instance_lease WHERE id = 1
    `).get() as { expires_at: number } | undefined
    return !lease || lease.expires_at < Date.now()
  } finally {
    inspection.close()
  }
}

export function openDatabase(databasePath = config.databasePath): DatabaseHandle {
  mkdirSync(path.dirname(databasePath), { recursive: true })
  const authorityPath = canonicalAuthorityPath(databasePath)
  const instanceId = randomUUID()
  const transitionLock = acquireAuthorityTransitionLock(authorityPath, {
    ownerId: instanceId,
    reclaimAfterMs: 30 * 60_000,
    legacyReclaimAfterMs: 30 * 60_000,
    canReclaim: () => databaseInstanceLeaseIsInactive(authorityPath),
  })
  let transitionReleased = false
  let lifetimeLock: InstanceLifetimeLock | null = null
  let db: Database.Database | null = null
  let leaseAcquired = false
  try {
    lifetimeLock = acquireInstanceLifetimeLock(
      authorityPath,
      instanceId,
      () => databaseInstanceLeaseIsInactive(authorityPath),
    )
    db = new Database(databasePath)
    const opened = db
    const journalMode = String(opened.pragma('journal_mode = DELETE', { simple: true })).toLowerCase()
    if (journalMode !== 'delete') {
      throw new Error(`SQLite refused DELETE journal mode: ${journalMode}`)
    }
    opened.pragma('foreign_keys = ON')
    opened.pragma(`busy_timeout = ${config.sqliteBusyTimeoutMs}`)
    migrate(opened)
    assertExactMarqueeSchema(opened)
    const leaseDurationMs = 60_000
    const acquireLease = opened.prepare(`
      INSERT INTO runtime_instance_lease(
        id, owner_id, acquired_at, heartbeat_at, expires_at
      ) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at
      WHERE runtime_instance_lease.expires_at < excluded.acquired_at
    `)
    const now = Date.now()
    if (acquireLease.run(instanceId, now, now, now + leaseDurationMs).changes !== 1) {
      throw new Error('Another Marquee process holds the active SQLite instance lease')
    }
    leaseAcquired = true
    lifetimeLock.commitReclamation()
    transitionLock.release()
    transitionReleased = true
    let leaseHealthy = true
    let leaseLossNotified = false
    const leaseLossListeners = new Set<() => void>()
    const markLeaseLost = () => {
      leaseHealthy = false
      if (leaseLossNotified) return
      leaseLossNotified = true
      for (const listener of leaseLossListeners) {
        try { listener() } catch { /* shutdown listeners must not block fencing */ }
      }
    }
    const assertInstanceLease = () => {
      if (!leaseHealthy) throw new Error('Runtime SQLite instance lease is not healthy')
      const lease = opened.prepare(`
        SELECT owner_id, expires_at FROM runtime_instance_lease WHERE id = 1
      `).get() as { owner_id: string; expires_at: number } | undefined
      if (!lease || lease.owner_id !== instanceId || lease.expires_at <= Date.now()) {
        markLeaseLost()
        throw new Error('Runtime SQLite instance lease is not owned by this process')
      }
    }
    const heartbeat = setInterval(() => {
      try {
        const heartbeatAt = Date.now()
        const result = opened.prepare(`
          UPDATE runtime_instance_lease
          SET heartbeat_at = ?, expires_at = ?
          WHERE id = 1 AND owner_id = ? AND expires_at > ?
        `).run(heartbeatAt, heartbeatAt + leaseDurationMs, instanceId, heartbeatAt)
        if (result.changes !== 1) markLeaseLost()
      } catch {
        markLeaseLost()
      }
    }, 20_000)
    heartbeat.unref()
    let closed = false
    return {
      db: opened,
      path: databasePath,
      schemaVersion: SCHEMA_VERSION,
      instanceId,
      instanceLeaseHealthy: () => leaseHealthy,
      assertInstanceLease,
      onInstanceLeaseLost: (listener) => {
        leaseLossListeners.add(listener)
        return () => leaseLossListeners.delete(listener)
      },
      close: () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        leaseLossListeners.clear()
        const cleanupErrors = collectCleanupErrors([
          () => opened.prepare(`
            DELETE FROM runtime_instance_lease WHERE id = 1 AND owner_id = ?
          `).run(instanceId),
          () => opened.close(),
          () => lifetimeLock?.release(),
        ])
        if (cleanupErrors.length === 1) throw cleanupErrors[0]
        if (cleanupErrors.length > 1) {
          throw new AggregateError(cleanupErrors, 'Database shutdown cleanup failed')
        }
      },
    }
  } catch (error) {
    const cleanupErrors = collectCleanupErrors([
      () => {
        if (leaseAcquired && db) {
          db.prepare(`
            DELETE FROM runtime_instance_lease WHERE id = 1 AND owner_id = ?
          `).run(instanceId)
        }
      },
      () => db?.close(),
      () => lifetimeLock?.release(),
      () => {
        if (!transitionReleased) transitionLock.release()
      },
    ])
    return throwWithCleanupErrors(error, cleanupErrors)
  }
}
