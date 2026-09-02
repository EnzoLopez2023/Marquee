import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROTECTED_CONFIGURATION_NAMES,
  RECOVERY_CONFIGURATION_NAMES,
  inspectMigrationPlan,
  normalizeSettingNames,
  runMigrationCheck,
  runProtectedConfigurationCheck,
  runReadinessCheck,
  runRecoveryCheck,
} from '../../scripts/deployment-precheck.mjs'

const directories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'marquee-deployment-diagnostics-'))
  directories.push(directory)
  return directory
}

function gitBlobSha(bytes: Buffer) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('deployment diagnostics adoption', () => {
  it('keeps the reviewed foundation templates byte-exact', () => {
    const helper = readFileSync('scripts/deployment-diagnostic.mjs')
    const action = readFileSync('.github/actions/deployment-diagnostic/action.yml')

    expect(gitBlobSha(helper)).toBe('d31a00faad5832832bf0b91e96387f5f77645700')
    expect(gitBlobSha(action)).toBe('ff7330e29f4f15abe61bf8c4f5520ff5f1674fc4')
  })

  it('records findings, execution failures, skips, and aggregation without gating', () => {
    const directory = temporaryDirectory()
    const records = path.join(directory, 'records.jsonl')
    const summary = path.join(directory, 'summary.md')
    const helper = path.resolve('scripts/deployment-diagnostic.mjs')
    const fakeSecret = 'test-secret-value-that-must-be-redacted'
    const finding = spawnSync(process.execPath, [
      helper,
      'run',
      '--check', 'source-dependency-audit',
      '--category', 'source-audit',
      '--phase', 'pre-build',
      '--records', records,
      '--',
      process.execPath,
      '-e',
      'process.stdout.write(process.env.TEST_API_TOKEN); process.exit(7)',
    ], {
      encoding: 'utf8',
      env: { ...process.env, TEST_API_TOKEN: fakeSecret },
    })
    expect(finding.status).toBe(0)

    const missingReport = spawnSync(process.execPath, [
      helper,
      'run',
      '--check', 'source-sbom',
      '--category', 'sbom',
      '--phase', 'pre-build',
      '--records', records,
      '--report', path.join(directory, 'missing.json'),
      '--report-format', 'cyclonedx-json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    ], { encoding: 'utf8' })
    expect(missingReport.status).toBe(0)

    const skipped = spawnSync(process.execPath, [
      helper,
      'skip',
      '--check', 'signature-verification',
      '--category', 'signature-provenance',
      '--phase', 'pre-activation',
      '--records', records,
      '--reason', 'candidate is not signed',
    ], { encoding: 'utf8' })
    expect(skipped.status).toBe(0)

    const aggregate = spawnSync(process.execPath, [
      helper,
      'aggregate',
      '--records', records,
    ], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    })
    expect(aggregate.status).toBe(0)

    const evidence = readFileSync(records, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(evidence).toMatchObject([
      {
        check_id: 'source-dependency-audit',
        status: 'finding',
        exit_code: 7,
        redaction: { applied: true, replacements: 1 },
      },
      {
        check_id: 'source-sbom',
        status: 'execution-failure',
      },
      {
        check_id: 'signature-verification',
        status: 'skipped-no-prerequisite',
      },
    ])
    expect(JSON.stringify(evidence)).not.toContain(fakeSecret)
    expect(readFileSync(summary, 'utf8')).toContain(
      'No result below changed whether this deployment proceeded.',
    )
  })

  it('fails only malformed helper authoring invocations', () => {
    const malformed = spawnSync(process.execPath, [
      'scripts/deployment-diagnostic.mjs',
      'run',
      '--check', 'source-dependency-audit',
      '--phase', 'pre-build',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    ], { encoding: 'utf8' })

    expect(malformed.status).toBe(2)
    expect(`${malformed.stdout}${malformed.stderr}`).toContain(
      'missing or unknown --category',
    )
  })

  it('computes migration and readiness outcomes from real source and endpoint data', async () => {
    const migrationFetch: typeof fetch = async () => jsonResponse({
      success: true,
      status: 'ready',
      database: { schemaVersion: 2 },
    })
    const plan = await inspectMigrationPlan()
    const migration = await runMigrationCheck({
      siteUrl: 'https://marquee.example.test',
      fetchImpl: migrationFetch,
    })
    expect(plan).toMatchObject({
      schema_version: 2,
      findings: [],
      migrations: [
        { version: 1, name: 'initial-marquee-schema' },
        { version: 2, name: 'app-local-feature-permissions' },
      ],
    })
    expect(migration).toMatchObject({
      check_id: 'migration-compatibility-precheck',
      outcome: 'pass',
      findings: [],
    })

    const readinessFetch: typeof fetch = async (input) => {
      const url = new URL(String(input))
      return jsonResponse({
        success: true,
        status: url.pathname.endsWith('/live') ? 'live' : 'ready',
        database: url.pathname.endsWith('/ready') ? { schemaVersion: 2 } : undefined,
      })
    }
    await expect(runReadinessCheck({
      siteUrl: 'https://marquee.example.test',
      fetchImpl: readinessFetch,
    })).resolves.toMatchObject({
      check_id: 'readiness-precondition-precheck',
      outcome: 'pass',
      findings: [],
    })
  })

  it('emits names-only recovery and protected-configuration evidence', async () => {
    const recovery = await runRecoveryCheck({
      settingNames: [...RECOVERY_CONFIGURATION_NAMES, 'PLEX_TOKEN'],
    })
    const configuration = runProtectedConfigurationCheck([
      ...PROTECTED_CONFIGURATION_NAMES,
      'ANTHROPIC_API_KEY',
    ])
    expect(recovery).toMatchObject({
      check_id: 'recovery-precondition-precheck',
      outcome: 'pass',
      findings: [],
    })
    expect(configuration).toMatchObject({
      check_id: 'protected-configuration-precheck',
      outcome: 'pass',
      findings: [],
    })
    expect(() => normalizeSettingNames([
      { name: 'PLEX_TOKEN', value: 'must-not-enter-evidence' },
    ])).toThrow('names only')
    expect(JSON.stringify({ recovery, configuration })).not.toContain(
      'must-not-enter-evidence',
    )
  })

  it('rejects value-bearing setting input without writing a report', () => {
    const directory = temporaryDirectory()
    const settings = path.join(directory, 'settings.json')
    const report = path.join(directory, 'report.json')
    const fakeSecret = 'must-not-enter-evidence'
    writeFileSync(settings, JSON.stringify([
      { name: 'PLEX_TOKEN', value: fakeSecret },
    ]))

    const result = spawnSync(process.execPath, [
      'scripts/deployment-precheck.mjs',
      'protected-configuration',
      '--settings-file', settings,
      '--output', report,
    ], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(existsSync(report)).toBe(false)
    expect(`${result.stdout}${result.stderr}`).not.toContain(fakeSecret)
  })

  it('keeps all diagnostics in the deploy job and all delivery gates blocking', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const helperUses = workflow.match(
      /uses: \.\/\.github\/actions\/deployment-diagnostic/g,
    ) ?? []
    const checkIds = [...workflow.matchAll(/check-id:\s*([a-z0-9-]+)/g)]
      .map((match) => match[1])
      .sort()

    expect(helperUses).toHaveLength(12)
    expect(checkIds).toEqual([
      'aggregate',
      'image-sbom',
      'image-vulnerability-scan',
      'migration-compatibility-precheck',
      'monitoring-precheck',
      'protected-configuration-precheck',
      'provenance-attestation-verification',
      'readiness-precondition-precheck',
      'recovery-precondition-precheck',
      'signature-verification',
      'source-dependency-audit',
      'source-sbom',
    ])
    expect(workflow).toContain(
      'f45790e9df7c9fabbc53dd04e6055a59d6f28f39/deployment-diagnostics',
    )
    expect(workflow).toContain(
      'npm test -- --run test/security/deploymentDiagnostics.test.ts',
    )
    expect(workflow).toContain(
      'npm sbom --sbom-format cyclonedx --package-lock-only',
    )
    expect(workflow).toContain('severity: HIGH,CRITICAL')
    expect(workflow).toContain('if: ${{ (failure() || cancelled())')
    expect(workflow.indexOf('Scan exact candidate image')).toBeLessThan(
      workflow.indexOf('az webapp config container set'),
    )
    expect(workflow.indexOf('Verify activated release health')).toBeGreaterThan(
      workflow.indexOf('az webapp config container set'),
    )
    expect(workflow.indexOf('Aggregate deployment diagnostics')).toBeGreaterThan(
      workflow.indexOf('Roll back failed activation'),
    )
  })
})
