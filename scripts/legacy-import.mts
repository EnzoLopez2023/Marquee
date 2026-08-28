import { existsSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { openDatabase } from '../lib/db/connection.js'
import {
  columns,
  canonicalLegacyOid,
  OWNED_TABLES,
  parseArgs,
  SOURCE_TENANT_ID,
  verifyApprovedSourceDatabase,
  verifySourceFile,
  verifyTargetTransformEvidence,
} from './importSupport.mjs'
import { loadApprovedSourceManifest } from './approvedSourceManifest.mjs'

const args = parseArgs(process.argv.slice(2))
const sourcePath = args.source
const targetPath = args.target
const manifestPath = args.manifest
if (!sourcePath || !targetPath || !manifestPath) {
  throw new Error(
    'Usage: npm run import:legacy -- --source <immutable.db> --target <empty.db> --manifest <approved.json> [--approval-key <ed25519-public.pem>]',
  )
}
if (sourcePath === '/home/data/hearth.db') throw new Error('Refusing to import from the live production path')
if (existsSync(targetPath)) throw new Error('Target must not already exist')
const legacyTime = (value: unknown) => {
  const parsed = Date.parse(`${String(value)}Z`)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid legacy timestamp: ${String(value)}`)
  return parsed
}
const bootstrapAdminOid = args['bootstrap-admin-oid']
  ? canonicalLegacyOid(args['bootstrap-admin-oid'])
  : ''

const approvedManifest = loadApprovedSourceManifest(manifestPath, args['approval-key'])
const evidence = await verifySourceFile(sourcePath, approvedManifest.evidence.database)
const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
source.pragma('query_only = ON')
verifyApprovedSourceDatabase(source, approvedManifest)
const target = openDatabase(targetPath)

try {
  const importAll = target.db.transaction(() => {
    for (const table of OWNED_TABLES) {
      const count = (source.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count
      const expectedCount = approvedManifest.evidence.ownedTables[table]!.rowCount
      if (count !== expectedCount) {
        throw new Error(`${table} source count ${count} does not match approved evidence ${expectedCount}`)
      }
      const sourceColumns = columns(source, table).map((column) => column.name)
      const targetColumns = new Set(columns(target.db, table).map((column) => column.name))
      const shared = sourceColumns.filter((column) => targetColumns.has(column))
      const placeholders = shared.map(() => '?').join(', ')
      const insert = target.db.prepare(
        `INSERT INTO "${table}" (${shared.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`,
      )
      const rows = source.prepare(`SELECT * FROM "${table}" ORDER BY id`).all() as Array<Record<string, unknown>>
      for (const row of rows) insert.run(...shared.map((column) => row[column]))
    }

    const insertLog = target.db.prepare(`
      INSERT INTO sonarr_agent_logs(legacy_id, ts, level, message, received_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const row of source.prepare(`
      SELECT id, ts, level, message, received_at FROM agent_logs
      WHERE agent = 'sonarr' ORDER BY id
    `).all() as any[]) {
      insertLog.run(row.id, row.ts, row.level, row.message, row.received_at)
    }

    const insertReceipt = target.db.prepare(`
      INSERT INTO sonarr_ingest_receipts(delivery_id, endpoint, received_at)
      VALUES (?, ?, ?)
    `)
    for (const row of source.prepare(`
      SELECT delivery_id, endpoint, received_at FROM agent_ingest_receipts
      WHERE endpoint = '/api/sonarr/ingest' ORDER BY delivery_id
    `).all() as any[]) {
      insertReceipt.run(row.delivery_id, row.endpoint, row.received_at)
    }

    const users = source.prepare(`
      SELECT id, email, name, azure_oid, created_at FROM hearth_users
      WHERE azure_oid IS NOT NULL AND trim(azure_oid) != ''
      ORDER BY id
    `).all() as any[]
    const identity = target.db.prepare(`
      INSERT OR IGNORE INTO app_identities(
        tenant_id, oid, email_snapshot, display_name_snapshot, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const user of users) {
      const oid = canonicalLegacyOid(user.azure_oid)
      const created = legacyTime(user.created_at)
      identity.run(SOURCE_TENANT_ID, oid, user.email, user.name, created, created)
    }
    const grant = target.db.prepare(`
      INSERT OR IGNORE INTO app_role_grants(
        tenant_id, oid, role, granted_at, granted_by_tenant_id, granted_by_oid
      ) VALUES (?, ?, ?, ?, NULL, NULL)
    `)
    const permissionRows = source.prepare(`
      SELECT u.azure_oid, u.created_at, p.feature, p.can_edit, p.is_hidden
      FROM hearth_permissions p
      JOIN hearth_users u ON u.id = p.user_id
      WHERE u.azure_oid IS NOT NULL
        AND p.feature IN ('halloween','plex-command-center','sonarr-dashboard')
      ORDER BY u.id, p.feature
    `).all() as any[]
    const featurePermission = target.db.prepare(`
      INSERT INTO app_feature_permissions(
        tenant_id, oid, feature, can_edit, is_hidden
      ) VALUES (?, ?, ?, ?, ?)
    `)
    const featureName = (legacy: string) => legacy === 'halloween' ? 'plex-library' : legacy
    for (const permission of permissionRows) {
      const oid = canonicalLegacyOid(permission.azure_oid)
      featurePermission.run(
        SOURCE_TENANT_ID,
        oid,
        featureName(permission.feature),
        permission.can_edit ? 1 : 0,
        permission.is_hidden ? 1 : 0,
      )
      if (permission.is_hidden) continue
      const grantedAt = legacyTime(permission.created_at)
      grant.run(SOURCE_TENANT_ID, oid, 'viewer', grantedAt)
      if (permission.can_edit && permission.feature === 'plex-command-center') {
        grant.run(SOURCE_TENANT_ID, oid, 'duplicate_delete', grantedAt)
      }
    }
    if (bootstrapAdminOid) {
      const bootstrapUser = users.find(
        (user) => canonicalLegacyOid(user.azure_oid) === bootstrapAdminOid,
      )
      if (!bootstrapUser) {
        throw new Error('Bootstrap administrator must match an imported legacy identity')
      }
      grant.run(
        SOURCE_TENANT_ID,
        bootstrapAdminOid,
        'admin',
        legacyTime(bootstrapUser.created_at),
      )
    }

    const auditRows = source.prepare(`
      SELECT * FROM audit_log
      WHERE view IN ('halloween','plex-command-center','sonarr-dashboard')
         OR path LIKE '/api/plex%'
         OR path LIKE '/api/tautulli%'
         OR path LIKE '/api/playlist-creator%'
         OR path LIKE '/api/sonarr%'
      ORDER BY id
    `).all() as any[]
    const audit = target.db.prepare(`
      INSERT INTO app_audit_log(
        legacy_id, ts, received_at, tenant_id, user_oid, user_email_snapshot,
        user_name_snapshot, verified, authoritative, source,
        category, action, view, method, path,
        status, detail, ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'legacy_client', ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of auditRows) {
      audit.run(
        row.id, row.ts, row.received_at,
        row.user_oid ? SOURCE_TENANT_ID : null,
        row.user_oid ? canonicalLegacyOid(row.user_oid) : null,
        row.user_email, row.user_name, row.verified,
        row.category, row.action, row.view, row.method, row.path,
        row.status, row.detail, row.ip,
      )
    }
  })
  importAll()
  const transformedEvidence = verifyTargetTransformEvidence(target.db, approvedManifest)
  console.log(JSON.stringify({
    ok: true,
    source: {
      path: sourcePath,
      commit: approvedManifest.evidence.source.commit,
      manifest: manifestPath,
      approval: approvedManifest.approval.method,
      ...evidence,
    },
    target: targetPath,
    imported: Object.fromEntries([
      ...OWNED_TABLES.map((table) => [
        table,
        (target.db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as any).count,
      ]),
      ['sonarr_agent_logs', (target.db.prepare('SELECT COUNT(*) AS count FROM sonarr_agent_logs').get() as any).count],
      ['sonarr_ingest_receipts', (target.db.prepare('SELECT COUNT(*) AS count FROM sonarr_ingest_receipts').get() as any).count],
      ['app_audit_log', (target.db.prepare('SELECT COUNT(*) AS count FROM app_audit_log').get() as any).count],
      ['app_identities', (target.db.prepare('SELECT COUNT(*) AS count FROM app_identities').get() as any).count],
      ['app_role_grants', (target.db.prepare('SELECT COUNT(*) AS count FROM app_role_grants').get() as any).count],
      ['app_feature_permissions', (target.db.prepare('SELECT COUNT(*) AS count FROM app_feature_permissions').get() as any).count],
    ]),
    transformedEvidence,
  }, null, 2))
} catch (error) {
  target.close()
  source.close()
  rmSync(targetPath, { force: true })
  throw error
}
target.close()
source.close()
