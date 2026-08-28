import { readFileSync } from 'node:fs'
import path from 'node:path'

const COMMIT = /^[0-9a-f]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const BUILD_ID = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/

export interface BuildMetadata {
  version: string
  commit: string
  buildId: string
  buildTime: string
}

export interface BuildIdentity extends BuildMetadata {
  app: 'marquee'
  environment: 'production' | 'local-development'
  imageDigest?: string
  sourceVersion: string
  sourceBuild: number
  sourceCommit: string
  sourceTree: string
  sourceImageDigest: string
}

function validMetadata(value: unknown): value is BuildMetadata {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BuildMetadata>
  return (
    typeof candidate.version === 'string'
    && SEMVER.test(candidate.version)
    && typeof candidate.commit === 'string'
    && COMMIT.test(candidate.commit)
    && typeof candidate.buildId === 'string'
    && BUILD_ID.test(candidate.buildId)
    && typeof candidate.buildTime === 'string'
    && Number.isFinite(Date.parse(candidate.buildTime))
  )
}

function localVersion(root: string) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.version)
      ? `${pkg.version}-local`
      : '0.0.0-local'
  } catch {
    return '0.0.0-local'
  }
}

export function loadBuildIdentity(
  root = process.env.MARQUEE_ROOT || process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): BuildIdentity {
  let metadata: BuildMetadata | null = null
  try {
    const value: unknown = JSON.parse(
      readFileSync(path.join(root, 'build-metadata.json'), 'utf8'),
    )
    if (validMetadata(value)) {
      metadata = value
    } else if (env.NODE_ENV === 'production') {
      throw new Error('Production build-metadata.json is invalid')
    }
  } catch (error) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Production requires readable image-baked build metadata', {
        cause: error,
      })
    }
    metadata = null
  }
  const production = env.NODE_ENV === 'production'
  const base = metadata ?? {
    version: localVersion(root),
    commit: 'local-development',
    buildId: 'local-development',
    buildTime: 'local-development',
  }
  const trustedDigest = env.MARQUEE_IMAGE_DIGEST_TRUSTED === 'true'
    && DIGEST.test(env.MARQUEE_IMAGE_DIGEST || '')
      ? env.MARQUEE_IMAGE_DIGEST
      : undefined
  return Object.freeze({
    app: 'marquee',
    environment: production ? 'production' : 'local-development',
    ...base,
    ...(trustedDigest ? { imageDigest: trustedDigest } : {}),
    sourceVersion: '2.13.2',
    sourceBuild: 172,
    sourceCommit: 'f0b05fc1dbf53e8aa26c215d8e858894a2793871',
    sourceTree: '62cbd35861c511f7c17187c875d19ee6e353b80d',
    sourceImageDigest: 'sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140',
  })
}

export function assertProductionBuildIdentity(
  identity: BuildIdentity = SOURCE,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV !== 'production') return
  if (
    identity.environment !== 'production'
    || !SEMVER.test(identity.version)
    || !COMMIT.test(identity.commit)
    || !BUILD_ID.test(identity.buildId)
    || !Number.isFinite(Date.parse(identity.buildTime))
  ) {
    throw new Error('Production requires valid image-baked Marquee build metadata')
  }
  if (
    env.MARQUEE_BUILD_VERSION !== identity.version
    || env.MARQUEE_BUILD_COMMIT !== identity.commit
    || env.MARQUEE_BUILD_ID !== identity.buildId
    || env.MARQUEE_BUILD_TIME !== identity.buildTime
  ) {
    throw new Error('Runtime Marquee build identity does not match the image-baked metadata')
  }
}

export const SOURCE = loadBuildIdentity()
