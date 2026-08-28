import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'

const REHEARSAL_PAYLOAD_SHA256 = '48ee350d6258b609e8e2ade953d3bdd8969cf4b107611fbd34aa5de02dba3569'
const HEX_64 = /^[a-f0-9]{64}$/
const OWNED_TABLES = [
  'plex_action_log',
  'sonarr_latest',
  'sonarr_metric_samples',
  'sonarr_summary',
]
const TRANSFORMS = [
  'sonarr_agent_logs',
  'sonarr_ingest_receipts',
  'app_identities',
  'app_feature_permissions',
  'app_role_grants',
  'app_audit_log',
]

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export interface ApprovedSourceManifest {
  contract: 'marquee.legacy-source-approval.v1'
  status: 'approved'
  evidence: {
    purpose: string
    source: {
      repository: string
      version: string
      build: number
      commit: string
      tree: string
      imageDigest: string
    }
    database: {
      bytes: number
      sha256: string
      schemaObjectCount: number
      quickCheck: 'ok'
      integrityCheck: 'ok'
      foreignKeyViolations: 0
    }
    ownedTables: Record<string, { rowCount: number; canonicalSha256: string }>
    product: { tableCount: number; rowCount: number; canonicalSha256: string }
    transforms: Record<string, { rowCount: number; canonicalSha256: string }>
  }
  approval: {
    method: 'repository-pinned' | 'ed25519'
    payloadSha256?: string
    signature?: string
    keyId?: string
  }
}

const approvalPayload = (manifest: ApprovedSourceManifest) => Buffer.from(canonicalJson({
  contract: manifest.contract,
  status: manifest.status,
  evidence: manifest.evidence,
}))

export function approvedManifestPayloadSha256(manifest: ApprovedSourceManifest) {
  return createHash('sha256').update(approvalPayload(manifest)).digest('hex')
}

export function loadApprovedSourceManifest(
  manifestPath: string,
  approvalPublicKeyPath?: string,
): ApprovedSourceManifest {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ApprovedSourceManifest
  validateEvidence(manifest)
  const payload = approvalPayload(manifest)
  const payloadSha256 = createHash('sha256').update(payload).digest('hex')
  if (manifest.approval?.method === 'repository-pinned') {
    if (
      payloadSha256 !== REHEARSAL_PAYLOAD_SHA256
      || manifest.approval.payloadSha256 !== REHEARSAL_PAYLOAD_SHA256
    ) throw new Error('Rehearsal source manifest is not the repository-pinned approval')
  } else if (manifest.approval?.method === 'ed25519') {
    if (!approvalPublicKeyPath || !manifest.approval.signature) {
      throw new Error('Signed final source manifest requires an approval public key and signature')
    }
    const publicKey = createPublicKey(readFileSync(approvalPublicKeyPath))
    if (!verify(null, payload, publicKey, Buffer.from(manifest.approval.signature, 'base64'))) {
      throw new Error('Final source manifest Ed25519 signature is invalid')
    }
  } else {
    throw new Error('Source manifest approval method is not trusted')
  }
  return manifest
}

function validateEvidence(manifest: ApprovedSourceManifest) {
  if (manifest.contract !== 'marquee.legacy-source-approval.v1' || manifest.status !== 'approved') {
    throw new Error('Source manifest contract/status is invalid')
  }
  const { source, database, ownedTables, product, transforms } = manifest.evidence ?? {}
  if (
    source?.repository !== 'EnzoLopez2023/Hearth'
    || source.version !== '2.13.2'
    || source.build !== 172
    || source.commit !== 'f0b05fc1dbf53e8aa26c215d8e858894a2793871'
    || source.tree !== '62cbd35861c511f7c17187c875d19ee6e353b80d'
    || source.imageDigest !== 'sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140'
  ) throw new Error('Source manifest baseline identity is invalid')
  if (
    !Number.isSafeInteger(database?.bytes)
    || database.bytes <= 0
    || !HEX_64.test(database.sha256)
    || !Number.isSafeInteger(database.schemaObjectCount)
    || database.quickCheck !== 'ok'
    || database.integrityCheck !== 'ok'
    || database.foreignKeyViolations !== 0
  ) throw new Error('Source manifest database evidence is invalid')
  if (
    Object.keys(ownedTables ?? {}).sort().join(',') !== [...OWNED_TABLES].sort().join(',')
    || Object.keys(transforms ?? {}).sort().join(',') !== [...TRANSFORMS].sort().join(',')
  ) throw new Error('Source manifest ownership evidence is incomplete')
  for (const row of [...Object.values(ownedTables), ...Object.values(transforms)]) {
    if (!Number.isSafeInteger(row.rowCount) || row.rowCount < 0 || !HEX_64.test(row.canonicalSha256)) {
      throw new Error('Source manifest row-count/canonical evidence is invalid')
    }
  }
  if (
    product.tableCount !== OWNED_TABLES.length
    || product.rowCount !== Object.values(ownedTables).reduce((sum, row) => sum + row.rowCount, 0)
    || !HEX_64.test(product.canonicalSha256)
  ) throw new Error('Source manifest product evidence is invalid')
}
