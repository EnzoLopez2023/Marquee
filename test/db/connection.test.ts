import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../lib/db/connection.js'
import {
  acquireAuthorityTransitionLock,
  acquireInstanceLifetimeLock,
  authorityTransitionLockPath,
  instanceLifetimeLockPath,
} from '../../lib/db/authorityTransitionLock.js'
import { readiness } from '../../lib/health/readiness.js'
import { temporaryDatabase } from '../helpers.js'

describe('SQLite authority', () => {
  it('uses DELETE mode, foreign keys, migrations, and immutable audit tables', () => {
    const handle = temporaryDatabase()
    try {
      expect(handle.db.pragma('journal_mode', { simple: true })).toBe('delete')
      expect(handle.db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(handle.schemaVersion).toBe(2)
      handle.db.prepare(`
        INSERT INTO plex_action_log(ts, action, status) VALUES (?, ?, ?)
      `).run(Date.now(), 'scan', 'success')
      expect(() => handle.db.prepare('DELETE FROM plex_action_log').run())
        .toThrow('append-only')
    } finally {
      handle.cleanup()
    }
  })

  it('fails startup and readiness when a required schema object is missing', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-schema-loss-'))
    const databasePath = path.join(directory, 'marquee.db')
    const handle = openDatabase(databasePath)
    handle.db.exec('DROP INDEX idx_sonarr_metrics_sampled')
    expect(readiness(handle)).toMatchObject({ statusCode: 503 })
    handle.close()
    expect(() => openDatabase(databasePath)).toThrow('schema object manifest')
    const inspection = new Database(databasePath, { readonly: true, fileMustExist: true })
    inspection.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('fails startup for unexpected migration rows before serving', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-extra-migration-'))
    const databasePath = path.join(directory, 'marquee.db')
    const handle = openDatabase(databasePath)
    handle.db.prepare(`
      INSERT INTO schema_migrations(version, name, checksum, applied_at)
      VALUES (99, 'unexpected', 'unexpected', ?)
    `).run(Date.now())
    handle.close()
    expect(() => openDatabase(databasePath)).toThrow('unexpected rows')
    rmSync(directory, { recursive: true, force: true })
  })

  it('allows only one active process lease for a database authority', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-instance-lease-'))
    const databasePath = path.join(directory, 'marquee.db')
    const first = openDatabase(databasePath)
    expect(() => openDatabase(databasePath)).toThrow('lifetime instance lock')
    first.close()
    const second = openDatabase(databasePath)
    expect(second.instanceLeaseHealthy()).toBe(true)
    second.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('reclaims a lifetime lock only after its durable instance lease expires', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-stale-instance-'))
    const databasePath = path.join(directory, 'marquee.db')
    const initial = openDatabase(databasePath)
    initial.close()
    const staleOwner = new Database(databasePath)
    staleOwner.prepare(`
      INSERT INTO runtime_instance_lease(
        id, owner_id, acquired_at, heartbeat_at, expires_at
      ) VALUES (1, 'stale-owner', ?, ?, ?)
    `).run(Date.now() - 120_000, Date.now() - 120_000, Date.now() - 60_000)
    staleOwner.close()
    mkdirSync(instanceLifetimeLockPath(databasePath), { mode: 0o700 })

    const recovered = openDatabase(databasePath)
    expect(recovered.instanceLeaseHealthy()).toBe(true)
    expect(recovered.instanceId).not.toBe('stale-owner')
    recovered.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('restores a displaced lifetime lock when database startup fails', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-stale-rollback-'))
    const databasePath = path.join(directory, 'marquee.db')
    const initial = openDatabase(databasePath)
    initial.close()
    const staleOwner = new Database(databasePath)
    staleOwner.exec('DROP INDEX idx_sonarr_metrics_sampled')
    staleOwner.prepare(`
      INSERT INTO runtime_instance_lease(
        id, owner_id, acquired_at, heartbeat_at, expires_at
      ) VALUES (1, 'stale-owner', ?, ?, ?)
    `).run(Date.now() - 120_000, Date.now() - 120_000, Date.now() - 60_000)
    staleOwner.close()
    const lockPath = instanceLifetimeLockPath(databasePath)
    mkdirSync(lockPath, { mode: 0o700 })

    expect(() => openDatabase(databasePath)).toThrow('schema object manifest')
    expect(existsSync(lockPath)).toBe(true)
    expect(existsSync(`${lockPath}.stale`)).toBe(false)
    rmSync(directory, { recursive: true, force: true })
  })

  it('keeps a replacement lock when the displaced owner releases late', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-lock-owner-'))
    const databasePath = path.join(directory, 'marquee.db')
    const first = acquireInstanceLifetimeLock(databasePath, 'first', () => true)
    const replacement = acquireInstanceLifetimeLock(databasePath, 'replacement', () => true)
    replacement.commitReclamation()

    first.release()
    expect(existsSync(instanceLifetimeLockPath(databasePath))).toBe(true)
    replacement.release()
    expect(existsSync(instanceLifetimeLockPath(databasePath))).toBe(false)
    rmSync(directory, { recursive: true, force: true })
  })

  it('reclaims only expired startup transition locks', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-transition-'))
    const databasePath = path.join(directory, 'marquee.db')
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const first = acquireAuthorityTransitionLock(databasePath, {
        ownerId: 'first',
        reclaimAfterMs: 1_000,
        canReclaim: () => true,
      })
      expect(() => acquireAuthorityTransitionLock(databasePath, {
        ownerId: 'early',
        reclaimAfterMs: 1_000,
        canReclaim: () => true,
      })).toThrow('authority transition')

      clock.mockReturnValue(now + 1_001)
      const replacement = acquireAuthorityTransitionLock(databasePath, {
        ownerId: 'replacement',
        reclaimAfterMs: 1_000,
        canReclaim: () => true,
      })
      first.release()
      expect(existsSync(authorityTransitionLockPath(databasePath))).toBe(true)
      replacement.release()
    } finally {
      clock.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reclaims an expired legacy startup transition lock', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-legacy-transition-'))
    const databasePath = path.join(directory, 'marquee.db')
    const lockPath = authorityTransitionLockPath(databasePath)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    mkdirSync(lockPath, { mode: 0o700 })
    try {
      clock.mockReturnValue(now + 30_001)
      const replacement = acquireAuthorityTransitionLock(databasePath, {
        ownerId: 'replacement',
        reclaimAfterMs: 30_000,
        legacyReclaimAfterMs: 30_000,
        canReclaim: () => true,
      })
      replacement.release()
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      clock.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not resurrect an expired durable lease', async () => {
    vi.useFakeTimers()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-expired-lease-'))
    const databasePath = path.join(directory, 'marquee.db')
    const startedAt = Date.now()
    vi.setSystemTime(startedAt)
    const handle = openDatabase(databasePath)
    try {
      vi.setSystemTime(startedAt + 60_001)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(handle.instanceLeaseHealthy()).toBe(false)
    } finally {
      handle.close()
      vi.useRealTimers()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('actively fences and notifies when instance lease ownership is lost', () => {
    const handle = temporaryDatabase()
    let notified = 0
    handle.onInstanceLeaseLost(() => { notified += 1 })
    handle.db.prepare(`
      UPDATE runtime_instance_lease
      SET owner_id = 'other-process', expires_at = ?
      WHERE id = 1
    `).run(Date.now() + 60_000)
    expect(() => handle.assertInstanceLease()).toThrow('not owned')
    expect(handle.instanceLeaseHealthy()).toBe(false)
    expect(notified).toBe(1)
    expect(() => handle.assertInstanceLease()).toThrow('not healthy')
    expect(notified).toBe(1)
    handle.cleanup()
  })
})
