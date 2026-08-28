import { mkdirSync } from 'node:fs'
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
  type AuthorityTransitionLock,
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

export function openDatabase(databasePath = config.databasePath): DatabaseHandle {
  mkdirSync(path.dirname(databasePath), { recursive: true })
  const authorityPath = canonicalAuthorityPath(databasePath)
  const transitionLock = acquireAuthorityTransitionLock(authorityPath)
  let lifetimeLock: AuthorityTransitionLock | null = null
  let db: Database.Database | null = null
  try {
    lifetimeLock = acquireInstanceLifetimeLock(authorityPath)
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
    const instanceId = randomUUID()
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
    transitionLock.release()
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
          WHERE id = 1 AND owner_id = ?
        `).run(heartbeatAt, heartbeatAt + leaseDurationMs, instanceId)
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
        try {
          opened.prepare(`
            DELETE FROM runtime_instance_lease WHERE id = 1 AND owner_id = ?
          `).run(instanceId)
        } finally {
          try {
            opened.close()
          } finally {
            lifetimeLock?.release()
          }
        }
      },
    }
  } catch (error) {
    try {
      db?.close()
    } finally {
      lifetimeLock?.release()
    }
    throw error
  } finally {
    transitionLock.release()
  }
}
