export interface PrecheckFinding {
  code: string
  detail: string
}

export interface MigrationPlan {
  schema_version: number | null
  migrations: Array<{
    version: number
    name: string
    path: string
    checksum: string
  }>
  findings: PrecheckFinding[]
}

export const REPORT_SCHEMA: 'marquee.deployment-precheck.v1'
export const RECOVERY_CONFIGURATION_NAMES: readonly string[]
export const PROTECTED_CONFIGURATION_NAMES: readonly string[]

export function normalizeSettingNames(value: unknown): string[]
export function inspectMigrationPlan(root?: string): Promise<MigrationPlan>
export function runMigrationCheck(options: {
  root?: string
  siteUrl: string
  fetchImpl?: typeof fetch
}): Promise<Record<string, unknown> & {
  outcome: 'pass' | 'finding'
  findings: PrecheckFinding[]
}>
export function runRecoveryCheck(options: {
  root?: string
  settingNames: unknown
}): Promise<Record<string, unknown> & {
  outcome: 'pass' | 'finding'
  findings: PrecheckFinding[]
}>
export function runReadinessCheck(options: {
  siteUrl: string
  fetchImpl?: typeof fetch
}): Promise<Record<string, unknown> & {
  outcome: 'pass' | 'finding'
  findings: PrecheckFinding[]
}>
export function runProtectedConfigurationCheck(
  settingNames: unknown,
): Record<string, unknown> & {
  outcome: 'pass' | 'finding'
  findings: PrecheckFinding[]
}
export function main(argv: string[]): Promise<number>
