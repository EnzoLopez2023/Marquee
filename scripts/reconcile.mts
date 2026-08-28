import Database from 'better-sqlite3'
import {
  columns,
  canonicalLegacyOid,
  canonicalRecordsHash,
  hasExactSchemaVersions,
  mappedTableHash,
  OWNED_TABLES,
  parseArgs,
  tableHash,
  verifyApprovedSourceDatabase,
  verifySourceFile,
  SOURCE_TENANT_ID,
} from './importSupport.mjs'
import { SCHEMA_VERSION } from '../lib/db/migrate.js'
import { loadApprovedSourceManifest } from './approvedSourceManifest.mjs'

const args = parseArgs(process.argv.slice(2))
if (!args.source || !args.target || !args.manifest) {
  throw new Error(
    'Usage: npm run reconcile -- --source <immutable.db> --target <marquee.db> --manifest <approved.json> [--approval-key <ed25519-public.pem>]',
  )
}
const approvedManifest = loadApprovedSourceManifest(args.manifest, args['approval-key'])
await verifySourceFile(args.source, approvedManifest.evidence.database)
const source = new Database(args.source, { readonly: true, fileMustExist: true })
const target = new Database(args.target, { readonly: true, fileMustExist: true })
source.pragma('query_only = ON')
target.pragma('query_only = ON')
verifyApprovedSourceDatabase(source, approvedManifest)
const bootstrapAdminOid = args['bootstrap-admin-oid']
  ? canonicalLegacyOid(args['bootstrap-admin-oid'])
  : ''

const report: any = { ok: true, owned: {}, transformed: {}, checks: {} }
for (const table of OWNED_TABLES) {
  const sourceColumns = columns(source, table).map((column) => column.name)
  const sourceResult = tableHash(source, table, sourceColumns)
  const targetResult = tableHash(target, table, sourceColumns)
  const ok = (
    sourceResult.count === approvedManifest.evidence.ownedTables[table]!.rowCount
    && sourceResult.count === targetResult.count
    && sourceResult.sha256 === targetResult.sha256
  )
  report.owned[table] = { ok, source: sourceResult, target: targetResult }
  if (!ok) report.ok = false
}

for (const item of [
  {
    name: 'sonarr_agent_logs',
    sourceTable: 'agent_logs',
    sourceColumns: ['id', 'ts', 'level', 'message', 'received_at'],
    targetColumns: ['legacy_id', 'ts', 'level', 'message', 'received_at'],
    where: "WHERE agent = 'sonarr'",
  },
  {
    name: 'sonarr_ingest_receipts',
    sourceTable: 'agent_ingest_receipts',
    sourceColumns: ['delivery_id', 'endpoint', 'received_at'],
    targetColumns: ['delivery_id', 'endpoint', 'received_at'],
    where: "WHERE endpoint = '/api/sonarr/ingest'",
  },
]) {
  const sourceResult = mappedTableHash(
    source,
    item.sourceTable,
    item.sourceColumns.map((column) => ({ logical: column, physical: column })),
    item.where,
  )
  const targetResult = mappedTableHash(
    target,
    item.name,
    item.sourceColumns.map((logical, index) => ({
      logical,
      physical: item.targetColumns[index]!,
    })),
  )
  const ok = sourceResult.count === targetResult.count && sourceResult.sha256 === targetResult.sha256
  report.transformed[item.name] = { ok, source: sourceResult, target: targetResult }
  if (!ok) report.ok = false
}

report.checks.foreignKeys = target.pragma('foreign_key_check')
report.checks.quick = target.pragma('quick_check')
report.checks.integrity = target.pragma('integrity_check')
report.checks.schemaVersion = target.prepare(
  'SELECT MAX(version) AS version FROM schema_migrations',
).get()
const schemaVersion = (report.checks.schemaVersion as { version: number | null }).version
const schemaRows = target.prepare(
  'SELECT version FROM schema_migrations ORDER BY version',
).all() as Array<{ version: number }>
report.checks.schemaVersions = schemaRows.map((row) => row.version)
if (
  schemaVersion !== SCHEMA_VERSION
  || !hasExactSchemaVersions(report.checks.schemaVersions, [1, 2])
) report.ok = false

const legacyTime = (value: unknown) => {
  const parsed = Date.parse(`${String(value)}Z`)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid legacy timestamp: ${String(value)}`)
  return parsed
}
const featureName = (legacy: string) => legacy === 'halloween' ? 'plex-library' : legacy
const users = source.prepare(`
  SELECT id, email, name, azure_oid, created_at FROM hearth_users
  WHERE azure_oid IS NOT NULL AND trim(azure_oid) != ''
  ORDER BY id
`).all() as any[]
const expectedIdentities = users.map((user) => {
  const created = legacyTime(user.created_at)
  return {
    tenant_id: SOURCE_TENANT_ID,
    oid: canonicalLegacyOid(user.azure_oid),
    email_snapshot: user.email,
    display_name_snapshot: user.name,
    first_seen_at: created,
    last_seen_at: created,
  }
})
const identityFields = [
  'tenant_id', 'oid', 'email_snapshot', 'display_name_snapshot',
  'first_seen_at', 'last_seen_at',
]
const actualIdentities = target.prepare(`
  SELECT ${identityFields.join(', ')} FROM app_identities
`).all() as Array<Record<string, unknown>>

const permissionRows = source.prepare(`
  SELECT u.azure_oid, u.created_at, p.feature, p.can_edit, p.is_hidden
  FROM hearth_permissions p
  JOIN hearth_users u ON u.id = p.user_id
  WHERE u.azure_oid IS NOT NULL
    AND p.feature IN ('halloween','plex-command-center','sonarr-dashboard')
  ORDER BY u.id, p.feature
`).all() as any[]
const expectedFeatures = permissionRows.map((row) => ({
  tenant_id: SOURCE_TENANT_ID,
  oid: canonicalLegacyOid(row.azure_oid),
  feature: featureName(row.feature),
  can_edit: row.can_edit ? 1 : 0,
  is_hidden: row.is_hidden ? 1 : 0,
}))
const featureFields = ['tenant_id', 'oid', 'feature', 'can_edit', 'is_hidden']
const actualFeatures = target.prepare(`
  SELECT ${featureFields.join(', ')} FROM app_feature_permissions
`).all() as Array<Record<string, unknown>>

const expectedRoleMap = new Map<string, Record<string, unknown>>()
for (const row of permissionRows) {
  if (row.is_hidden) continue
  const grantedAt = legacyTime(row.created_at)
  const oid = canonicalLegacyOid(row.azure_oid)
  const add = (role: string) => expectedRoleMap.set(`${oid}:${role}`, {
    tenant_id: SOURCE_TENANT_ID,
    oid,
    role,
    granted_at: grantedAt,
    granted_by_tenant_id: null,
    granted_by_oid: null,
  })
  add('viewer')
  if (row.can_edit && row.feature === 'plex-command-center') add('duplicate_delete')
}
if (bootstrapAdminOid) {
  const bootstrapUser = users.find(
    (user) => canonicalLegacyOid(user.azure_oid) === bootstrapAdminOid,
  )
  if (!bootstrapUser) throw new Error('Bootstrap administrator must match an imported legacy identity')
  expectedRoleMap.set(`${bootstrapAdminOid}:admin`, {
    tenant_id: SOURCE_TENANT_ID,
    oid: bootstrapAdminOid,
    role: 'admin',
    granted_at: legacyTime(bootstrapUser.created_at),
    granted_by_tenant_id: null,
    granted_by_oid: null,
  })
}
const roleFields = [
  'tenant_id', 'oid', 'role', 'granted_at', 'granted_by_tenant_id', 'granted_by_oid',
]
const actualRoles = target.prepare(`
  SELECT ${roleFields.join(', ')} FROM app_role_grants
`).all() as Array<Record<string, unknown>>

const sourceAudit = source.prepare(`
  SELECT * FROM audit_log
  WHERE view IN ('halloween','plex-command-center','sonarr-dashboard')
     OR path LIKE '/api/plex%'
     OR path LIKE '/api/tautulli%'
     OR path LIKE '/api/playlist-creator%'
     OR path LIKE '/api/sonarr%'
  ORDER BY id
`).all() as any[]
const expectedAudit = sourceAudit.map((row) => ({
  legacy_id: row.id,
  ts: row.ts,
  received_at: row.received_at,
  tenant_id: row.user_oid ? SOURCE_TENANT_ID : null,
  user_oid: row.user_oid ? canonicalLegacyOid(row.user_oid) : null,
  user_email_snapshot: row.user_email,
  user_name_snapshot: row.user_name,
  verified: row.verified,
  authoritative: 0,
  source: 'legacy_client',
  category: row.category,
  action: row.action,
  view: row.view,
  method: row.method,
  path: row.path,
  status: row.status,
  detail: row.detail,
  ip: row.ip,
}))
const auditFields = [
  'legacy_id', 'ts', 'received_at', 'tenant_id', 'user_oid',
  'user_email_snapshot', 'user_name_snapshot', 'verified',
  'authoritative', 'source', 'category',
  'action', 'view', 'method', 'path', 'status', 'detail', 'ip',
]
const actualAudit = target.prepare(`
  SELECT ${auditFields.join(', ')} FROM app_audit_log WHERE legacy_id IS NOT NULL
`).all() as Array<Record<string, unknown>>

for (const dataset of [
  { name: 'app_identities', expected: expectedIdentities, actual: actualIdentities, fields: identityFields, sort: ['tenant_id', 'oid'] },
  { name: 'app_feature_permissions', expected: expectedFeatures, actual: actualFeatures, fields: featureFields, sort: ['tenant_id', 'oid', 'feature'] },
  { name: 'app_role_grants', expected: [...expectedRoleMap.values()], actual: actualRoles, fields: roleFields, sort: ['tenant_id', 'oid', 'role'] },
  { name: 'app_audit_log', expected: expectedAudit, actual: actualAudit, fields: auditFields, sort: ['legacy_id'] },
]) {
  const expected = canonicalRecordsHash(dataset.expected, dataset.fields, dataset.sort)
  const actual = canonicalRecordsHash(dataset.actual, dataset.fields, dataset.sort)
  const ok = expected.count === actual.count && expected.sha256 === actual.sha256
  report.transformed[dataset.name] = { ok, source: expected, target: actual }
  if (!ok) report.ok = false
}
for (const [name, result] of Object.entries(report.transformed) as Array<[string, any]>) {
  const approved = approvedManifest.evidence.transforms[name]
  if (
    !approved
    || approved.rowCount !== result.target.count
    || approved.canonicalSha256 !== result.target.sha256
  ) {
    result.approvedManifestMismatch = true
    report.ok = false
  }
}
report.approvedSource = {
  manifest: args.manifest,
  approval: approvedManifest.approval.method,
  payloadSha256: approvedManifest.approval.payloadSha256 ?? null,
}
if (report.checks.foreignKeys.length) report.ok = false
if (report.checks.quick.some((row: any) => row.quick_check !== 'ok')) report.ok = false
if (report.checks.integrity.some((row: any) => row.integrity_check !== 'ok')) report.ok = false

console.log(JSON.stringify(report, null, 2))
target.close()
source.close()
if (!report.ok) process.exitCode = 1
