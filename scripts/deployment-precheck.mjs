#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REPORT_SCHEMA = 'marquee.deployment-precheck.v1'
export const RECOVERY_CONFIGURATION_NAMES = Object.freeze([
  'BACKUP_STORAGE_ACCOUNT_URL',
  'BACKUP_STORAGE_CONTAINER',
  'DB_PATH',
  'MARQUEE_ARTIFACT_ROOT',
])
export const PROTECTED_CONFIGURATION_NAMES = Object.freeze([
  'DB_PATH',
  'MARQUEE_ARTIFACT_ROOT',
  'WEBSITES_ENABLE_APP_SERVICE_STORAGE',
  'WEBSITES_PORT',
])

const CHECKS = Object.freeze({
  migration: 'migration-compatibility-precheck',
  recovery: 'recovery-precondition-precheck',
  readiness: 'readiness-precondition-precheck',
  'protected-configuration': 'protected-configuration-precheck',
})
const SETTING_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/
const FETCH_TIMEOUT_MS = 5_000

function finding(code, detail) {
  return { code, detail }
}

function outcome(findings) {
  return findings.length === 0 ? 'pass' : 'finding'
}

function baseReport(checkId, findings) {
  return {
    schema: REPORT_SCHEMA,
    schema_version: '1.0',
    check_id: checkId,
    generated_at: new Date().toISOString(),
    outcome: outcome(findings),
    findings,
  }
}

async function readSource(root, relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

export function normalizeSettingNames(value) {
  if (!Array.isArray(value) || value.some((entry) => (
    typeof entry !== 'string' || !SETTING_NAME.test(entry)
  ))) {
    throw new Error('App setting evidence must be a JSON array containing names only')
  }
  return [...new Set(value)].sort()
}

function configurationResult(observedNames, requiredNames) {
  const observed = new Set(observedNames)
  const missing = requiredNames.filter((name) => !observed.has(name))
  return {
    observed_names: observedNames,
    required_names: [...requiredNames],
    missing_names: missing,
  }
}

async function inspectSourceControls(root, controls) {
  const results = []
  const findings = []
  for (const control of controls) {
    let source
    try {
      source = await readSource(root, control.path)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      findings.push(finding('SOURCE_UNREADABLE', `${control.path}: ${detail}`))
      results.push({ id: control.id, path: control.path, present: false })
      continue
    }
    const missingMarkers = control.markers.filter((marker) => !source.includes(marker))
    if (missingMarkers.length > 0) {
      findings.push(finding(
        'SOURCE_CONTROL_MISSING',
        `${control.path} no longer implements ${control.id}`,
      ))
    }
    results.push({
      id: control.id,
      path: control.path,
      present: missingMarkers.length === 0,
    })
  }
  return { results, findings }
}

export async function inspectMigrationPlan(root = process.cwd()) {
  const registryPath = 'lib/db/migrate.ts'
  const registry = await readSource(root, registryPath)
  const imports = new Map()
  const importPattern =
    /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.\/migrations\/[A-Za-z0-9._/-]+)\.js['"]/g
  for (const match of registry.matchAll(importPattern)) {
    imports.set(match[1], `${match[2].slice(2)}.ts`)
  }

  const listMatch = registry.match(/const\s+migrations\s*=\s*\[([^\]]*)\]/)
  if (!listMatch) {
    return {
      schema_version: null,
      migrations: [],
      findings: [finding(
        'MIGRATION_REGISTRY_MALFORMED',
        `${registryPath} does not declare the ordered migration registry`,
      )],
    }
  }

  const aliases = listMatch[1].split(',').map((entry) => entry.trim()).filter(Boolean)
  const migrations = []
  const findings = []
  for (const alias of aliases) {
    const importedPath = imports.get(alias)
    if (!importedPath) {
      findings.push(finding(
        'MIGRATION_IMPORT_MISSING',
        `${registryPath} registers ${alias} without a migration module import`,
      ))
      continue
    }
    const relativePath = path.posix.join('lib/db', importedPath)
    let source
    try {
      source = await readSource(root, relativePath)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      findings.push(finding('MIGRATION_SOURCE_UNREADABLE', `${relativePath}: ${detail}`))
      continue
    }
    const versionMatch = source.match(/export\s+const\s+version\s*=\s*(\d+)/)
    const nameMatch = source.match(/export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/)
    const sqlMatch = source.match(/export\s+const\s+sql\s*=\s*`([\s\S]*?)`/)
    if (!versionMatch || !nameMatch || !sqlMatch || sqlMatch[1].trim() === '') {
      findings.push(finding(
        'MIGRATION_SOURCE_MALFORMED',
        `${relativePath} must export a numeric version, non-empty name, and SQL body`,
      ))
      continue
    }
    migrations.push({
      version: Number.parseInt(versionMatch[1], 10),
      name: nameMatch[1],
      path: relativePath,
      checksum: createHash('sha256').update(sqlMatch[1]).digest('hex'),
    })
  }

  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index].version !== index + 1) {
      findings.push(finding(
        'MIGRATION_SEQUENCE_GAP',
        `Expected migration version ${index + 1}, found ${migrations[index].version}`,
      ))
    }
  }
  if (new Set(migrations.map(({ name }) => name)).size !== migrations.length) {
    findings.push(finding('MIGRATION_NAME_DUPLICATE', 'Migration names must be unique'))
  }

  return {
    schema_version: migrations.at(-1)?.version ?? null,
    migrations,
    findings,
  }
}

function normalizeSiteUrl(value) {
  const site = new URL(value)
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password) {
    throw new Error('Site URL must be an HTTP(S) URL without credentials')
  }
  site.pathname = '/'
  site.search = ''
  site.hash = ''
  return site
}

async function fetchEndpoint(siteUrl, endpoint, fetchImpl) {
  const target = new URL(endpoint, normalizeSiteUrl(siteUrl))
  const response = await fetchImpl(target, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    // A malformed health payload is a check finding, not success-shaped evidence.
  }
  return {
    status_code: response.status,
    ok: response.ok,
    success: body?.success === true,
    status: typeof body?.status === 'string' && /^[a-z-]{1,32}$/.test(body.status)
      ? body.status
      : null,
    schema_version: Number.isInteger(body?.database?.schemaVersion)
      ? body.database.schemaVersion
      : null,
  }
}

export async function runMigrationCheck({
  root = process.cwd(),
  siteUrl,
  fetchImpl = fetch,
}) {
  const plan = await inspectMigrationPlan(root)
  const deployed = await fetchEndpoint(siteUrl, '/api/ready', fetchImpl)
  const findings = [...plan.findings]
  if (!deployed.ok || !deployed.success || deployed.status !== 'ready') {
    findings.push(finding(
      'DEPLOYED_READINESS_UNAVAILABLE',
      `Deployed readiness returned HTTP ${deployed.status_code}`,
    ))
  }
  if (deployed.schema_version === null) {
    findings.push(finding(
      'DEPLOYED_SCHEMA_VERSION_MISSING',
      'Deployed readiness did not report an integer schema version',
    ))
  } else if (
    plan.schema_version !== null
    && deployed.schema_version > plan.schema_version
  ) {
    findings.push(finding(
      'SCHEMA_DOWNGRADE_UNSAFE',
      `Candidate schema ${plan.schema_version} is older than deployed schema ${deployed.schema_version}`,
    ))
  }
  return {
    ...baseReport(CHECKS.migration, findings),
    candidate: {
      schema_version: plan.schema_version,
      migrations: plan.migrations,
    },
    deployed,
  }
}

export async function runRecoveryCheck({
  root = process.cwd(),
  settingNames,
}) {
  const configuration = configurationResult(
    normalizeSettingNames(settingNames),
    RECOVERY_CONFIGURATION_NAMES,
  )
  const source = await inspectSourceControls(root, [
    {
      id: 'recovery-cli',
      path: 'scripts/recovery.mts',
      markers: ['createBackup', 'verifyBackup', 'restoreBackup', 'uploadAndVerifyBackup'],
    },
    {
      id: 'database-integrity-verification',
      path: 'lib/recovery/backup.ts',
      markers: ['quick_check', 'integrity_check', 'foreign_key_check', 'MIGRATION_IDENTITIES'],
    },
    {
      id: 'off-host-readback-verification',
      path: 'lib/recovery/offhost.ts',
      markers: ['downloadToFile', 'readback.sha256', 'readback.bytes'],
    },
  ])
  const findings = [...source.findings]
  if (configuration.missing_names.length > 0) {
    findings.push(finding(
      'RECOVERY_CONFIGURATION_MISSING',
      `Missing recovery app setting name(s): ${configuration.missing_names.join(', ')}`,
    ))
  }
  return {
    ...baseReport(CHECKS.recovery, findings),
    configuration,
    source_controls: source.results,
  }
}

export async function runReadinessCheck({
  siteUrl,
  fetchImpl = fetch,
}) {
  const [live, ready] = await Promise.all([
    fetchEndpoint(siteUrl, '/api/live', fetchImpl),
    fetchEndpoint(siteUrl, '/api/ready', fetchImpl),
  ])
  const findings = []
  if (!live.ok || !live.success || live.status !== 'live') {
    findings.push(finding(
      'LIVENESS_PRECONDITION_FAILED',
      `Liveness returned HTTP ${live.status_code}`,
    ))
  }
  if (!ready.ok || !ready.success || ready.status !== 'ready') {
    findings.push(finding(
      'READINESS_PRECONDITION_FAILED',
      `Readiness returned HTTP ${ready.status_code}`,
    ))
  }
  return {
    ...baseReport(CHECKS.readiness, findings),
    endpoints: { live, ready },
  }
}

export function runProtectedConfigurationCheck(settingNames) {
  const configuration = configurationResult(
    normalizeSettingNames(settingNames),
    PROTECTED_CONFIGURATION_NAMES,
  )
  const findings = configuration.missing_names.length === 0
    ? []
    : [finding(
        'PROTECTED_CONFIGURATION_MISSING',
        `Missing protected app setting name(s): ${configuration.missing_names.join(', ')}`,
      )]
  return {
    ...baseReport(CHECKS['protected-configuration'], findings),
    configuration,
  }
}

function parseArgs(argv) {
  const [command, ...tokens] = argv
  if (!(command in CHECKS)) {
    throw new Error(
      'Expected migration, recovery, readiness, or protected-configuration',
    )
  }
  const options = { command }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    if (!['output', 'root', 'settings-file', 'site-url'].includes(key)) {
      throw new Error(`Unknown option: ${token}`)
    }
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`)
    options[key] = value
    index += 1
  }
  if (!options.output) throw new Error('--output is required')
  return options
}

async function readSettingNames(filePath) {
  return normalizeSettingNames(JSON.parse(await readFile(filePath, 'utf8')))
}

async function writeReport(filePath, report) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function main(argv) {
  const options = parseArgs(argv)
  const root = path.resolve(options.root ?? process.cwd())
  let report
  if (options.command === 'migration') {
    if (!options['site-url']) throw new Error('migration requires --site-url')
    report = await runMigrationCheck({ root, siteUrl: options['site-url'] })
  } else if (options.command === 'recovery') {
    if (!options['settings-file']) throw new Error('recovery requires --settings-file')
    report = await runRecoveryCheck({
      root,
      settingNames: await readSettingNames(options['settings-file']),
    })
  } else if (options.command === 'readiness') {
    if (!options['site-url']) throw new Error('readiness requires --site-url')
    report = await runReadinessCheck({ siteUrl: options['site-url'] })
  } else {
    if (!options['settings-file']) {
      throw new Error('protected-configuration requires --settings-file')
    }
    report = runProtectedConfigurationCheck(
      await readSettingNames(options['settings-file']),
    )
  }

  await writeReport(options.output, report)
  process.stdout.write(
    `${report.check_id}: ${report.outcome} (${report.findings.length} finding(s))\n`,
  )
  for (const entry of report.findings) {
    process.stderr.write(`${entry.code}: ${entry.detail}\n`)
  }
  return report.findings.length === 0 ? 0 : 1
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `deployment precheck failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 2
  }
}
