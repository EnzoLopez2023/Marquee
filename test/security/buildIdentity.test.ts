import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertProductionBuildIdentity,
  loadBuildIdentity,
} from '../../lib/health/buildIdentity.js'

const commit = '0123456789abcdef0123456789abcdef01234567'
const directories: string[] = []

function root() {
  const directory = mkdtempSync(path.join(tmpdir(), 'marquee-build-identity-'))
  directories.push(directory)
  writeFileSync(path.join(directory, 'package.json'), '{"version":"0.1.0"}')
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Marquee build identity', () => {
  it('labels a source checkout as local development', () => {
    const identity = loadBuildIdentity(root(), { NODE_ENV: 'development' })
    expect(identity).toMatchObject({
      version: '0.1.0-local',
      commit: 'local-development',
      buildId: 'local-development',
      environment: 'local-development',
    })
    expect(identity).not.toHaveProperty('imageDigest')
  })

  it('requires production metadata and exact runtime agreement', () => {
    const directory = root()
    const metadata = {
      version: '0.1.0+run.42',
      commit,
      buildId: '1234.2',
      buildTime: '2026-08-28T20:00:00Z',
    }
    writeFileSync(
      path.join(directory, 'build-metadata.json'),
      JSON.stringify(metadata),
    )
    const env = {
      NODE_ENV: 'production',
      MARQUEE_BUILD_VERSION: '0.1.0+run.42',
      MARQUEE_BUILD_COMMIT: commit,
      MARQUEE_BUILD_ID: '1234.2',
      MARQUEE_BUILD_TIME: '2026-08-28T20:00:00Z',
    }
    const identity = loadBuildIdentity(directory, env)
    expect(() => assertProductionBuildIdentity(identity, env)).not.toThrow()
    expect(() => assertProductionBuildIdentity(identity, {
      ...env,
      MARQUEE_BUILD_ID: 'other.1',
    })).toThrow('does not match')
  })

  it('fails production closed when baked metadata is missing or malformed', () => {
    const directory = root()
    mkdirSync(path.join(directory, 'unused'))
    const env = {
      NODE_ENV: 'production',
      MARQUEE_BUILD_VERSION: '0.1.0+run.42',
      MARQUEE_BUILD_COMMIT: commit,
      MARQUEE_BUILD_ID: '1234.2',
      MARQUEE_BUILD_TIME: '2026-08-28T20:00:00Z',
    }
    expect(() => loadBuildIdentity(directory, env)).toThrow(
      'requires readable image-baked',
    )
  })

  it('reports an image digest only with explicit verified provenance', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    expect(loadBuildIdentity(root(), {
      NODE_ENV: 'development',
      MARQUEE_IMAGE_DIGEST: digest,
    })).not.toHaveProperty('imageDigest')
    expect(loadBuildIdentity(root(), {
      NODE_ENV: 'development',
      MARQUEE_IMAGE_DIGEST: digest,
      MARQUEE_IMAGE_DIGEST_TRUSTED: 'true',
    }).imageDigest).toBe(digest)
  })
})
