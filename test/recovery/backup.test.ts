import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createBackup, restoreBackup, verifyBackup } from '../../lib/recovery/backup.js'
import { temporaryDatabase } from '../helpers.js'

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
      const restored = await restoreBackup(backupPath, restorePath)
      expect(restored.sha256).toBe(manifest.sha256)
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
