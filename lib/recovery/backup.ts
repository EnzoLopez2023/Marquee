import { createHash } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATION_IDENTITIES } from '../db/migrate.js'
import { assertExactMarqueeSchema } from '../db/schemaIdentity.js'
import {
  acquireAuthorityTransitionLock,
  authorityTransitionLockPath,
  canonicalAuthorityPath,
  instanceLifetimeLockPath,
} from '../db/authorityTransitionLock.js'

class ActiveDestinationLeaseError extends Error {}

const sha256 = async (filePath: string) => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

export async function createBackup(sourcePath: string, destinationPath: string) {
  mkdirSync(path.dirname(destinationPath), { recursive: true })
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    assertMarqueeDatabase(source)
    await source.backup(destinationPath)
  } finally {
    source.close()
  }
  return verifyBackup(destinationPath)
}

export async function verifyBackup(filePath: string) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const identity = assertMarqueeDatabase(db)
    const quick = db.pragma('quick_check') as Array<{ quick_check: string }>
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const foreignKeys = db.pragma('foreign_key_check') as unknown[]
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all() as Array<{ name: string }>
    const counts = Object.fromEntries(tables.map(({ name }) => [
      name,
      (db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count,
    ]))
    const result = {
      file: path.basename(filePath),
      bytes: statSync(filePath).size,
      sha256: await sha256(filePath),
      checks: { quick, integrity, foreignKeys },
      identity,
      counts,
    }
    if (
      quick.some((row) => row.quick_check !== 'ok')
      || integrity.some((row) => row.integrity_check !== 'ok')
      || foreignKeys.length
    ) throw new Error('Backup verification failed')
    return result
  } finally {
    db.close()
  }
}

export async function restoreBackup(
  backupPath: string,
  destinationPath: string,
  options: {
    beforePublish?: (stagedPath: string, destinationPath: string) => void | Promise<void>
    afterAtomicPublish?: (destinationPath: string) => void | Promise<void>
  } = {},
) {
  const sourceBackup = await verifyBackup(backupPath)
  const destination = path.resolve(destinationPath)
  const physicalDestination = canonicalAuthorityPath(destination)
  const parent = path.dirname(destination)
  mkdirSync(parent, { recursive: true })
  const transitionLocks: ReturnType<typeof acquireAuthorityTransitionLock>[] = []
  try {
    const seenLockPaths = new Set<string>()
    // Hold the stable logical basename and the pre-publish physical target.
    // openDatabase() resolves to one of these on either side of symlink replacement.
    for (const authorityPath of [destination, physicalDestination].sort()) {
      const lockPath = authorityTransitionLockPath(authorityPath)
      if (seenLockPaths.has(lockPath)) continue
      seenLockPaths.add(lockPath)
      transitionLocks.push(acquireAuthorityTransitionLock(authorityPath))
    }
  } catch (error) {
    for (const lock of [...transitionLocks].reverse()) lock.release()
    throw error
  }
  let stagingDirectory: string | null = null
  let restored:
    | (Awaited<ReturnType<typeof verifyBackup>> & {
        stagedSha256: string
        sourceBackupSha256: string
        atomicPublish: true
      })
    | undefined
  let operationError: unknown = null
  try {
    if (existsSync(instanceLifetimeLockPath(physicalDestination))) {
      throw new Error(
        'Restore destination has an active or stale lifetime instance lock; fence the service before restore',
      )
    }
    for (const sidecarBase of new Set([destination, physicalDestination])) {
      assertNoDestinationSidecars(sidecarBase)
    }
    assertNoHardLinkAliases(physicalDestination)
    assertDestinationQuiesced(physicalDestination)
    stagingDirectory = mkdtempSync(path.join(parent, '.marquee-restore-'))
    chmodSync(stagingDirectory, 0o700)
    const stagedPath = path.join(stagingDirectory, 'marquee.db')
    const source = new Database(backupPath, { readonly: true, fileMustExist: true })
    try {
      await source.backup(stagedPath)
    } finally {
      source.close()
    }
    const stagedDatabase = new Database(stagedPath)
    try {
      stagedDatabase.transaction(() => {
        stagedDatabase.prepare('DELETE FROM runtime_instance_lease').run()
        stagedDatabase.prepare('DELETE FROM plex_delete_locks').run()
      })()
    } finally {
      stagedDatabase.close()
    }
    const staged = await verifyBackup(stagedPath)
    await options.beforePublish?.(stagedPath, destination)
    if (
      existsSync(destination)
      && canonicalAuthorityPath(destination) !== physicalDestination
    ) {
      throw new Error('Restore destination changed during authority transition')
    }
    assertNoHardLinkAliases(physicalDestination)
    renameSync(stagedPath, destination)
    await options.afterAtomicPublish?.(destination)
    restored = {
      ...(await verifyBackup(destination)),
      stagedSha256: staged.sha256,
      sourceBackupSha256: sourceBackup.sha256,
      atomicPublish: true as const,
    }
  } catch (error) {
    operationError = error
  }
  let cleanupError: unknown = null
  try {
    if (stagingDirectory) {
      rmSync(stagingDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    cleanupError ??= error
  }
  for (const lock of [...transitionLocks].reverse()) {
    try {
      lock.release()
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (cleanupError) throw cleanupError
  if (operationError) throw operationError
  if (!restored) throw new Error('Restore did not produce a verified destination')
  return restored
}

function assertNoHardLinkAliases(destinationPath: string) {
  if (!existsSync(destinationPath)) return
  if (statSync(destinationPath).nlink > 1) {
    throw new Error(
      'Restore destination has multiple hard links; remove aliases before restore',
    )
  }
}

function assertNoDestinationSidecars(destinationPath: string) {
  const sidecars = ['-journal', '-wal', '-shm']
    .map((suffix) => `${destinationPath}${suffix}`)
    .filter((sidecar) => existsSync(sidecar))
  if (sidecars.length) {
    throw new Error(
      'Restore destination has SQLite sidecars; recover and quiesce the existing database before restore',
    )
  }
}

function assertDestinationQuiesced(destinationPath: string) {
  if (!existsSync(destinationPath)) return
  let destination: Database.Database
  try {
    destination = new Database(destinationPath, {
      readonly: true,
      fileMustExist: true,
    })
  } catch {
    return
  }
  try {
    const hasLeaseTable = destination.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'runtime_instance_lease'
    `).get()
    if (!hasLeaseTable) return
    const lease = destination.prepare(`
      SELECT expires_at FROM runtime_instance_lease WHERE id = 1
    `).get() as { expires_at: number } | undefined
    if (lease && lease.expires_at > Date.now()) {
      throw new ActiveDestinationLeaseError(
        'Restore destination has an active Marquee instance lease; stop the service before restore',
      )
    }
  } catch (error) {
    if (error instanceof ActiveDestinationLeaseError) throw error
    // A non-SQLite destination or unrelated schema can be atomically replaced.
  } finally {
    destination.close()
  }
}

function assertMarqueeDatabase(db: Database.Database) {
  let metadata: Array<{ key: string; value: string }>
  let migrations: Array<{ version: number; name: string; checksum: string }>
  try {
    metadata = db.prepare(
      'SELECT key, value FROM app_metadata ORDER BY key',
    ).all() as Array<{ key: string; value: string }>
    migrations = db.prepare(`
      SELECT version, name, checksum FROM schema_migrations ORDER BY version
    `).all() as Array<{ version: number; name: string; checksum: string }>
  } catch {
    throw new Error('Database is not a Marquee backup')
  }
  const values = Object.fromEntries(metadata.map((row) => [row.key, row.value]))
  if (
    values.application_id !== 'marquee'
    || values.schema_contract !== 'marquee.sqlite.v2'
    || JSON.stringify(migrations) !== JSON.stringify(MIGRATION_IDENTITIES)
  ) {
    throw new Error('Database has an invalid Marquee application or migration identity')
  }
  const schemaObjects = assertExactMarqueeSchema(db)
  return {
    applicationId: values.application_id,
    schemaContract: values.schema_contract,
    migrations,
    schemaObjects,
  }
}
