import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { ApprovedSourceManifest } from './approvedSourceManifest.mjs'

export const SOURCE_COMMIT = 'f0b05fc1dbf53e8aa26c215d8e858894a2793871'
export const SOURCE_TENANT_ID = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const OWNED_TABLES = [
  'plex_action_log',
  'sonarr_latest',
  'sonarr_summary',
  'sonarr_metric_samples',
]

export function canonicalLegacyOid(value: unknown) {
  const oid = String(value ?? '').trim().toLowerCase()
  if (!GUID.test(oid)) throw new Error(`Invalid legacy Azure OID: ${String(value)}`)
  return oid
}

export async function fileSha256(filePath: string) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

export async function verifySourceFile(
  filePath: string,
  evidence: ApprovedSourceManifest['evidence']['database'],
) {
  const bytes = statSync(filePath).size
  if (bytes !== evidence.bytes) {
    throw new Error(`Source bytes mismatch: ${bytes} != ${evidence.bytes}`)
  }
  const sha256 = await fileSha256(filePath)
  if (sha256 !== evidence.sha256) throw new Error(`Source SHA-256 mismatch: ${sha256}`)
  return { bytes, sha256 }
}

const writeLength = (hash: ReturnType<typeof createHash>, length: number) => {
  const encoded = Buffer.alloc(8)
  encoded.writeBigUInt64BE(BigInt(length))
  hash.update(encoded)
}

const writeHearthCanonicalValue = (
  hash: ReturnType<typeof createHash>,
  value: unknown,
) => {
  if (value === null) {
    hash.update('N')
    writeLength(hash, 0)
    return
  }
  if (Buffer.isBuffer(value)) {
    hash.update('B')
    writeLength(hash, value.length)
    hash.update(value)
    return
  }
  const tag = typeof value === 'bigint' ? 'I' : typeof value === 'number' ? 'F' : 'T'
  const encoded = Buffer.from(String(value), 'utf8')
  hash.update(tag)
  writeLength(hash, encoded.length)
  hash.update(encoded)
}

export function hearthCanonicalTableHash(db: Database.Database, table: string) {
  db.defaultSafeIntegers(true)
  try {
    const tableColumns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      cid: bigint
      name: string
      type: string
      pk: bigint
    }>).sort((left, right) => Number(left.cid - right.cid))
    if (!tableColumns.length) throw new Error(`Approved source table ${table} is missing`)
    const primary = tableColumns
      .filter((column) => column.pk > 0n)
      .sort((left, right) => Number(left.pk - right.pk))
    const order = primary.length
      ? primary.map((column) => `"${column.name}"`).join(', ')
      : 'rowid'
    const hash = createHash('sha256')
    hash.update('hearth.sqlite-table-canonical.v1\0')
    writeHearthCanonicalValue(hash, table)
    writeHearthCanonicalValue(hash, tableColumns.length)
    for (const column of tableColumns) {
      writeHearthCanonicalValue(hash, column.name)
      writeHearthCanonicalValue(hash, column.type ?? '')
    }
    let rowCount = 0
    const rows = db.prepare(`
      SELECT ${tableColumns.map((column) => `"${column.name}"`).join(', ')}
      FROM "${table}" ORDER BY ${order}
    `).iterate() as Iterable<Record<string, unknown>>
    for (const row of rows) {
      hash.update('R')
      for (const column of tableColumns) {
        writeHearthCanonicalValue(hash, row[column.name])
      }
      rowCount += 1
    }
    return { rowCount, canonicalSha256: hash.digest('hex') }
  } finally {
    db.defaultSafeIntegers(false)
  }
}

export function verifyApprovedSourceDatabase(
  db: Database.Database,
  manifest: ApprovedSourceManifest,
) {
  const schemaObjectCount = (
    db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number }
  ).count
  if (schemaObjectCount !== manifest.evidence.database.schemaObjectCount) {
    throw new Error('Approved source schema object count mismatch')
  }
  const tableResults = new Map<string, { rowCount: number; canonicalSha256: string }>()
  for (const table of OWNED_TABLES) {
    const actual = hearthCanonicalTableHash(db, table)
    const expected = manifest.evidence.ownedTables[table]
    if (
      !expected
      || actual.rowCount !== expected.rowCount
      || actual.canonicalSha256 !== expected.canonicalSha256
    ) throw new Error(`Approved source canonical evidence mismatch for ${table}`)
    tableResults.set(table, actual)
  }
  const productHash = createHash('sha256')
  productHash.update('hearth.sqlite-product-canonical.v1\0')
  writeHearthCanonicalValue(productHash, 'Marquee')
  for (const table of [...OWNED_TABLES].sort()) {
    const result = tableResults.get(table)!
    writeHearthCanonicalValue(productHash, table)
    writeHearthCanonicalValue(productHash, result.canonicalSha256)
    writeHearthCanonicalValue(productHash, result.rowCount)
  }
  if (productHash.digest('hex') !== manifest.evidence.product.canonicalSha256) {
    throw new Error('Approved source Marquee product canonical evidence mismatch')
  }
}

export const columns = (db: Database.Database, table: string) => (
  db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>
)

export function canonicalValue(value: unknown): Buffer {
  if (value === null || value === undefined) return Buffer.from('n:;')
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`b:${value.length}:`), value, Buffer.from(';')])
  }
  const type = typeof value === 'number' ? 'd' : typeof value === 'bigint' ? 'i' : 's'
  const data = Buffer.from(String(value), 'utf8')
  return Buffer.concat([Buffer.from(`${type}:${data.length}:`), data, Buffer.from(';')])
}

export function tableHash(
  db: Database.Database,
  table: string,
  selectedColumns?: string[],
  where = '',
) {
  const allColumns = columns(db, table)
  const names = selectedColumns ?? allColumns.map((column) => column.name)
  const primary = allColumns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk)
  const order = primary.length ? primary.map((column) => `"${column.name}"`).join(', ') : 'rowid'
  const rows = db.prepare(
    `SELECT ${names.map((name) => `"${name}"`).join(', ')} FROM "${table}" ${where} ORDER BY ${order}`,
  ).all() as Array<Record<string, unknown>>
  const digest = createHash('sha256')
  for (const row of rows) {
    for (const name of names) {
      digest.update(canonicalValue(name))
      digest.update(canonicalValue(row[name]))
    }
    digest.update(Buffer.from('\n'))
  }
  return { count: rows.length, sha256: digest.digest('hex'), columns: names }
}

export function mappedTableHash(
  db: Database.Database,
  table: string,
  mapping: Array<{ logical: string; physical: string }>,
  where = '',
) {
  const rows = db.prepare(`
    SELECT ${mapping.map(({ logical, physical }) => `"${physical}" AS "${logical}"`).join(', ')}
    FROM "${table}" ${where}
    ORDER BY "${mapping[0]?.physical}"
  `).all() as Array<Record<string, unknown>>
  const digest = createHash('sha256')
  for (const row of rows) {
    for (const { logical } of mapping) {
      digest.update(canonicalValue(logical))
      digest.update(canonicalValue(row[logical]))
    }
    digest.update(Buffer.from('\n'))
  }
  return {
    count: rows.length,
    sha256: digest.digest('hex'),
    columns: mapping.map(({ logical }) => logical),
  }
}

export function canonicalRecordsHash(
  records: Array<Record<string, unknown>>,
  fields: string[],
  sortFields: string[],
) {
  const sorted = [...records].sort((left, right) => {
    for (const field of sortFields) {
      const comparison = Buffer.compare(canonicalValue(left[field]), canonicalValue(right[field]))
      if (comparison) return comparison
    }
    return 0
  })
  const digest = createHash('sha256')
  for (const row of sorted) {
    for (const field of fields) {
      digest.update(canonicalValue(field))
      digest.update(canonicalValue(row[field]))
    }
    digest.update(Buffer.from('\n'))
  }
  return { count: sorted.length, sha256: digest.digest('hex'), fields }
}

export function targetTransformEvidence(db: Database.Database) {
  const evidence: Record<string, { rowCount: number; canonicalSha256: string }> = {}
  const mapped = (
    name: string,
    mapping: Array<{ logical: string; physical: string }>,
  ) => {
    const result = mappedTableHash(db, name, mapping)
    evidence[name] = { rowCount: result.count, canonicalSha256: result.sha256 }
  }
  mapped('sonarr_agent_logs', [
    { logical: 'id', physical: 'legacy_id' },
    { logical: 'ts', physical: 'ts' },
    { logical: 'level', physical: 'level' },
    { logical: 'message', physical: 'message' },
    { logical: 'received_at', physical: 'received_at' },
  ])
  mapped('sonarr_ingest_receipts', [
    { logical: 'delivery_id', physical: 'delivery_id' },
    { logical: 'endpoint', physical: 'endpoint' },
    { logical: 'received_at', physical: 'received_at' },
  ])
  const recordEvidence = (name: string, fields: string[], sort: string[]) => {
    const rows = db.prepare(
      `SELECT ${fields.join(', ')} FROM "${name}"`,
    ).all() as Array<Record<string, unknown>>
    const result = canonicalRecordsHash(rows, fields, sort)
    evidence[name] = { rowCount: result.count, canonicalSha256: result.sha256 }
  }
  recordEvidence('app_identities', [
    'tenant_id', 'oid', 'email_snapshot', 'display_name_snapshot',
    'first_seen_at', 'last_seen_at',
  ], ['tenant_id', 'oid'])
  recordEvidence('app_feature_permissions', [
    'tenant_id', 'oid', 'feature', 'can_edit', 'is_hidden',
  ], ['tenant_id', 'oid', 'feature'])
  recordEvidence('app_role_grants', [
    'tenant_id', 'oid', 'role', 'granted_at',
    'granted_by_tenant_id', 'granted_by_oid',
  ], ['tenant_id', 'oid', 'role'])
  recordEvidence('app_audit_log', [
    'legacy_id', 'ts', 'received_at', 'tenant_id', 'user_oid',
    'user_email_snapshot', 'user_name_snapshot', 'verified',
    'authoritative', 'source', 'category', 'action', 'view', 'method',
    'path', 'status', 'detail', 'ip',
  ], ['legacy_id'])
  return evidence
}

export function verifyTargetTransformEvidence(
  db: Database.Database,
  manifest: ApprovedSourceManifest,
) {
  const actual = targetTransformEvidence(db)
  for (const [name, approved] of Object.entries(manifest.evidence.transforms)) {
    const result = actual[name]
    if (
      !result
      || result.rowCount !== approved.rowCount
      || result.canonicalSha256 !== approved.canonicalSha256
    ) throw new Error(`Imported transform evidence mismatch for ${name}`)
  }
  return actual
}

export const hasExactSchemaVersions = (
  actual: number[],
  expected: number[],
) => actual.length === expected.length
  && actual.every((version, index) => version === expected[index])

export function parseArgs(argv: string[]) {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item?.startsWith('--')) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${item}`)
    values[item.slice(2)] = value
    index += 1
  }
  return values
}
