import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../lib/db/connection.js'
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
    expect(() => openDatabase(databasePath)).toThrow('active SQLite instance lease')
    first.close()
    const second = openDatabase(databasePath)
    expect(second.instanceLeaseHealthy()).toBe(true)
    second.close()
    rmSync(directory, { recursive: true, force: true })
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
