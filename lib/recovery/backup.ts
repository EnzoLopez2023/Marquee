import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATION_IDENTITIES } from '../db/migrate.js'
import { assertExactMarqueeSchema } from '../db/schemaIdentity.js'

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

export async function restoreBackup(backupPath: string, destinationPath: string) {
  await verifyBackup(backupPath)
  const source = new Database(backupPath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destinationPath)
  } finally {
    source.close()
  }
  return verifyBackup(destinationPath)
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
