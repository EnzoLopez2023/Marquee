import {
  lstatSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createBackup, restoreBackup, verifyBackup } from '../../lib/recovery/backup.js'
import { temporaryDatabase } from '../helpers.js'
import { openDatabase } from '../../lib/db/connection.js'

describe('database-native recovery', () => {
  it('backs up, verifies, and restores with the online backup API', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-recovery-'))
    try {
      source.db.prepare('INSERT INTO plex_action_log(ts, action, status) VALUES (?, ?, ?)')
        .run(1, 'scan', 'success')
      const backupPath = path.join(directory, 'backup.db')
      const restorePath = path.join(directory, 'restore.db')
      const manifest = await createBackup(source.path, backupPath)
      expect(manifest.counts.plex_action_log).toBe(1)
      const existing = openDatabase(restorePath)
      existing.db.prepare(`
        INSERT INTO plex_action_log(ts, action, status) VALUES (2, 'old', 'success')
      `).run()
      existing.close()
      const restored = await restoreBackup(backupPath, restorePath)
      expect(restored.sourceBackupSha256).toBe(manifest.sha256)
      expect(restored.atomicPublish).toBe(true)
      expect(restored.counts.runtime_instance_lease).toBe(0)
      const immediate = openDatabase(restorePath)
      immediate.close()
      const published = new Database(restorePath, { readonly: true, fileMustExist: true })
      expect(published.prepare('SELECT action FROM plex_action_log').all())
        .toEqual([{ action: 'scan' }])
      published.close()
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('leaves an existing destination unchanged on pre-publish failure', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-failure-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    try {
      await createBackup(source.path, backupPath)
      const destination = openDatabase(destinationPath)
      destination.db.prepare(`
        INSERT INTO plex_action_log(ts, action, status) VALUES (3, 'existing', 'success')
      `).run()
      destination.close()
      const before = readFileSync(destinationPath)
      await expect(restoreBackup(backupPath, destinationPath, {
        beforePublish: () => { throw new Error('injected pre-publish failure') },
      })).rejects.toThrow('injected pre-publish failure')
      expect(readFileSync(destinationPath)).toEqual(before)
      expect(readdirSync(directory).filter((name) => name.startsWith('.marquee-restore-')))
        .toEqual([])
      expect(readdirSync(directory).filter((name) => name.includes('authority-transition')))
        .toEqual([])
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses replacement while a live instance lease owns the destination', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-live-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    let liveDestination: ReturnType<typeof openDatabase> | null = null
    try {
      await createBackup(source.path, backupPath)
      liveDestination = openDatabase(destinationPath)
      liveDestination.db.prepare(`
        INSERT INTO plex_action_log(ts, action, status) VALUES (4, 'live', 'success')
      `).run()
      const before = readFileSync(destinationPath)
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('lifetime instance lock')
      expect(readFileSync(destinationPath)).toEqual(before)
      expect(liveDestination.db.prepare(
        'SELECT action FROM plex_action_log',
      ).all()).toEqual([{ action: 'live' }])
      expect(readdirSync(directory).filter((name) => (
        name.startsWith('.marquee-restore-') || name.includes('authority-transition')
      ))).toEqual([])
    } finally {
      liveDestination?.close()
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a paused live instance even after its database lease expires', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-expired-live-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    let paused: ReturnType<typeof openDatabase> | null = null
    try {
      await createBackup(source.path, backupPath)
      paused = openDatabase(destinationPath)
      paused.db.prepare(`
        UPDATE runtime_instance_lease SET expires_at = ? WHERE id = 1
      `).run(Date.now() - 1)
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('lifetime instance lock')
      expect(paused.db.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 })
    } finally {
      paused?.close()
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('blocks a new database startup during atomic restore publication', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-start-race-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    try {
      await createBackup(source.path, backupPath)
      const existing = openDatabase(destinationPath)
      existing.close()
      await restoreBackup(backupPath, destinationPath, {
        beforePublish: () => {
          expect(() => openDatabase(destinationPath)).toThrow(
            'authority transition is already in progress',
          )
        },
      })
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('atomically replaces a destination symlink without touching its target', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-symlink-'))
    const backupPath = path.join(directory, 'backup.db')
    const sentinelPath = path.join(directory, 'sentinel.txt')
    const destinationPath = path.join(directory, 'destination.db')
    try {
      await createBackup(source.path, backupPath)
      writeFileSync(sentinelPath, 'sentinel-must-remain')
      symlinkSync(sentinelPath, destinationPath)
      await restoreBackup(backupPath, destinationPath)
      expect(lstatSync(destinationPath).isSymbolicLink()).toBe(false)
      expect(readFileSync(sentinelPath, 'utf8')).toBe('sentinel-must-remain')
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fences an active database opened through a symlink target alias', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-symlink-live-'))
    const backupPath = path.join(directory, 'backup.db')
    const targetPath = path.join(directory, 'physical.db')
    const destinationPath = path.join(directory, 'alias.db')
    let live: ReturnType<typeof openDatabase> | null = null
    try {
      await createBackup(source.path, backupPath)
      live = openDatabase(targetPath)
      live.db.prepare(`
        UPDATE runtime_instance_lease SET expires_at = ? WHERE id = 1
      `).run(Date.now() - 1)
      symlinkSync(targetPath, destinationPath)
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('lifetime instance lock')
      expect(lstatSync(destinationPath).isSymbolicLink()).toBe(true)
      expect(live.db.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 })
    } finally {
      live?.close()
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps symlink-alias startup fenced after rename through final verification', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-symlink-publish-'))
    const backupPath = path.join(directory, 'backup.db')
    const targetPath = path.join(directory, 'physical.db')
    const aliasPath = path.join(directory, 'alias.db')
    try {
      await createBackup(source.path, backupPath)
      const physical = openDatabase(targetPath)
      physical.close()
      symlinkSync(targetPath, aliasPath)
      await restoreBackup(backupPath, aliasPath, {
        afterAtomicPublish: () => {
          expect(lstatSync(aliasPath).isSymbolicLink()).toBe(false)
          expect(() => openDatabase(aliasPath)).toThrow(
            'authority transition is already in progress',
          )
        },
      })
      const started = openDatabase(aliasPath)
      started.close()
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses stale sidecars adjacent to a logical symlink alias', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-alias-journal-'))
    const backupPath = path.join(directory, 'backup.db')
    const targetPath = path.join(directory, 'physical.db')
    const destinationPath = path.join(directory, 'alias.db')
    const aliasJournal = `${destinationPath}-journal`
    try {
      await createBackup(source.path, backupPath)
      const physical = openDatabase(targetPath)
      physical.close()
      symlinkSync(targetPath, destinationPath)
      const journal = Buffer.from('alias-journal-must-remain')
      writeFileSync(aliasJournal, journal)
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('recover and quiesce')
      expect(lstatSync(destinationPath).isSymbolicLink()).toBe(true)
      expect(readFileSync(aliasJournal)).toEqual(journal)
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a hard-link alias to a paused database authority', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-hardlink-'))
    const backupPath = path.join(directory, 'backup.db')
    const targetPath = path.join(directory, 'physical.db')
    const aliasPath = path.join(directory, 'hardlink.db')
    let paused: ReturnType<typeof openDatabase> | null = null
    try {
      await createBackup(source.path, backupPath)
      paused = openDatabase(targetPath)
      paused.db.prepare(`
        UPDATE runtime_instance_lease SET expires_at = ? WHERE id = 1
      `).run(Date.now() - 1)
      linkSync(targetPath, aliasPath)
      await expect(restoreBackup(backupPath, aliasPath))
        .rejects.toThrow('multiple hard links')
      expect(statSync(aliasPath).ino).toBe(statSync(targetPath).ino)
      expect(paused.db.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 })
    } finally {
      paused?.close()
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses stale SQLite sidecars before staging or publishing', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-journal-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    const journalPath = `${destinationPath}-journal`
    try {
      await createBackup(source.path, backupPath)
      const destination = openDatabase(destinationPath)
      destination.close()
      const before = readFileSync(destinationPath)
      const journal = Buffer.from('stale-hot-journal-bytes')
      writeFileSync(journalPath, journal)
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('recover and quiesce')
      expect(readFileSync(destinationPath)).toEqual(before)
      expect(readFileSync(journalPath)).toEqual(journal)
      expect(readdirSync(directory).filter((name) => (
        name.startsWith('.marquee-restore-') || name.includes('authority-transition')
      ))).toEqual([])
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses WAL/SHM sidecars without changing the destination', async () => {
    const source = temporaryDatabase()
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-restore-journal-failure-'))
    const backupPath = path.join(directory, 'backup.db')
    const destinationPath = path.join(directory, 'destination.db')
    const walPath = `${destinationPath}-wal`
    const shmPath = `${destinationPath}-shm`
    try {
      await createBackup(source.path, backupPath)
      const destination = openDatabase(destinationPath)
      destination.close()
      const before = readFileSync(destinationPath)
      writeFileSync(walPath, 'stale-wal')
      writeFileSync(shmPath, 'stale-shm')
      await expect(restoreBackup(backupPath, destinationPath))
        .rejects.toThrow('recover and quiesce')
      expect(readFileSync(destinationPath)).toEqual(before)
      expect(readFileSync(walPath, 'utf8')).toBe('stale-wal')
      expect(readFileSync(shmPath, 'utf8')).toBe('stale-shm')
      expect(readdirSync(directory).filter((name) => (
        name.startsWith('.marquee-restore-') || name.includes('authority-transition')
      ))).toEqual([])
    } finally {
      source.cleanup()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects unrelated or migration-tampered SQLite files before restore', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-recovery-invalid-'))
    const unrelatedPath = path.join(directory, 'unrelated.db')
    const destinationPath = path.join(directory, 'must-not-exist.db')
    const unrelated = new Database(unrelatedPath)
    unrelated.exec('CREATE TABLE healthy(id INTEGER PRIMARY KEY)')
    unrelated.close()
    try {
      await expect(verifyBackup(unrelatedPath)).rejects.toThrow('not a Marquee')
      await expect(restoreBackup(unrelatedPath, destinationPath)).rejects.toThrow('not a Marquee')
      expect(() => new Database(destinationPath, { readonly: true, fileMustExist: true })).toThrow()

      const valid = temporaryDatabase()
      try {
        valid.db.prepare(
          "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 2",
        ).run()
        await expect(verifyBackup(valid.path)).rejects.toThrow('invalid Marquee')
      } finally {
        valid.cleanup()
      }

      const missingObject = temporaryDatabase()
      try {
        missingObject.db.exec('DROP INDEX idx_sonarr_metrics_sampled')
        await expect(verifyBackup(missingObject.path))
          .rejects.toThrow('schema object manifest')
      } finally {
        missingObject.cleanup()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
