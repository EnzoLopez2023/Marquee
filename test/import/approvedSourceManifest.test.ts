import {
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  loadApprovedSourceManifest,
} from '../../scripts/approvedSourceManifest.mjs'

const rehearsalPath = 'config/rehearsal-source-manifest.json'

describe('approved legacy source manifests', () => {
  it('accepts the repository-pinned f0 rehearsal and rejects self-declared edits', () => {
    expect(loadApprovedSourceManifest(rehearsalPath).evidence.purpose)
      .toBe('f0-production-rehearsal')
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-manifest-'))
    try {
      const manifest = JSON.parse(readFileSync(rehearsalPath, 'utf8'))
      manifest.evidence.purpose = 'arbitrary-self-declared-source'
      const changed = path.join(directory, 'changed.json')
      writeFileSync(changed, JSON.stringify(manifest))
      expect(() => loadApprovedSourceManifest(changed)).toThrow('repository-pinned')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('accepts a changed post-quiescence manifest only with an Ed25519 approval', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'marquee-signed-manifest-'))
    try {
      const manifest = JSON.parse(readFileSync(rehearsalPath, 'utf8'))
      manifest.evidence.purpose = 'post-quiescence-final'
      manifest.evidence.database.bytes += 4096
      manifest.evidence.database.sha256 = 'a'.repeat(64)
      const payload = Buffer.from(canonicalJson({
        contract: manifest.contract,
        status: manifest.status,
        evidence: manifest.evidence,
      }))
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      manifest.approval = {
        method: 'ed25519',
        keyId: 'operator-test',
        signature: sign(null, payload, privateKey).toString('base64'),
      }
      const manifestPath = path.join(directory, 'final.json')
      const publicKeyPath = path.join(directory, 'operator-public.pem')
      writeFileSync(manifestPath, JSON.stringify(manifest))
      writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
      expect(loadApprovedSourceManifest(manifestPath, publicKeyPath).evidence.purpose)
        .toBe('post-quiescence-final')
      manifest.approval.signature = Buffer.from('invalid').toString('base64')
      writeFileSync(manifestPath, JSON.stringify(manifest))
      expect(() => loadApprovedSourceManifest(manifestPath, publicKeyPath))
        .toThrow('signature is invalid')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
