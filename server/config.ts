import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'
import { canonicalPlexId } from './domain/media/plexId.js'
import {
  assertPlexTlsConfiguration,
  plexTlsMode,
} from './domain/media/plexTls.js'

const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const guidEnv = (value: string | undefined) => (value || '').trim().toLowerCase()

export function resolveTenantId(env: NodeJS.ProcessEnv) {
  const canonical = guidEnv(env.AZURE_AD_TENANT_ID)
  const legacy = guidEnv(env.AAD_TENANT_ID)
  if (canonical && legacy && canonical !== legacy) {
    throw new Error('AZURE_AD_TENANT_ID and legacy AAD_TENANT_ID conflict')
  }
  return canonical || legacy
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production'
  const clientId = guidEnv(env.AZURE_AD_CLIENT_ID)
  return Object.freeze({
    production,
    port: integer(env.PORT, 3001, 1, 65_535),
    host: production ? '0.0.0.0' : (env.HOST || '127.0.0.1'),
    databasePath: env.DB_PATH || (production ? '/home/data/marquee.db' : path.resolve('marquee.db')),
    artifactRoot: env.MARQUEE_ARTIFACT_ROOT
      || (production ? '/home/data/marquee-artifacts' : path.resolve('marquee-artifacts')),
    sqliteBusyTimeoutMs: integer(env.SQLITE_BUSY_TIMEOUT_MS, 5_000, 250, 15_000),
    entra: {
      tenantId: resolveTenantId(env),
      clientId,
      audience: (env.AZURE_AD_AUDIENCE || '').trim(),
      adminOid: guidEnv(env.ADMIN_OID),
      bootstrapAdminOid: guidEnv(env.MARQUEE_BOOTSTRAP_ADMIN_OID),
      userScope: 'Marquee.User',
      workloads: {
        watchtower: {
          tenantId: guidEnv(env.WATCHTOWER_WORKLOAD_TENANT_ID),
          audience: (env.WATCHTOWER_WORKLOAD_AUDIENCE || '').trim(),
          clientId: guidEnv(env.WATCHTOWER_CLIENT_ID),
          role: (env.WATCHTOWER_APP_ROLE || 'Marquee.Watchtower.MediaHealth.Read').trim(),
        },
        prism: {
          clientId: guidEnv(env.PRISM_CLIENT_ID),
          readRole: env.PRISM_READ_APP_ROLE || 'Marquee.Prism.Media.Read',
          writeRole: env.PRISM_WRITE_APP_ROLE || 'Marquee.Prism.Media.Write',
        },
      },
    },
    plex: {
      baseUrl: (env.PLEX_BASE_URL || 'https://localhost:32400').replace(/\/$/, ''),
      token: env.PLEX_TOKEN || '',
      librarySection: env.PLEX_LIBRARY_SECTION || '9',
      tls: {
        insecure: env.PLEX_TLS_INSECURE === 'true',
        caFile: env.PLEX_TLS_CA_FILE || '',
        certificateSha256: (env.PLEX_TLS_CERT_SHA256 || '')
          .replaceAll(':', '')
          .toLowerCase(),
      },
    },
    tautulli: {
      url: (env.TAUTULLI_URL || 'http://localhost:8181').replace(/\/$/, ''),
      apiKey: env.TAUTULLI_API_KEY || '',
    },
    omdbApiKey: env.OMDB_API_KEY || '',
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    playlistModel: {
      endpoint: (env.VIBE_OPENAI_ENDPOINT || '').replace(/\/$/, ''),
      apiKey: env.VIBE_OPENAI_API_KEY || '',
      deployment: env.VIBE_OPENAI_DEPLOYMENT || 'gpt-5.4',
    },
    sonarrIngestToken: env.SONARR_INGEST_TOKEN || '',
  })
}

export type MarqueeConfig = ReturnType<typeof loadConfig>
export const config = loadConfig()

export function validateConfig(
  candidate: MarqueeConfig = config,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!canonicalPlexId(candidate.plex.librarySection)) {
    throw new Error('PLEX_LIBRARY_SECTION must be a canonical positive integer')
  }
  assertPlexTlsConfiguration(candidate.plex.baseUrl, candidate.plex.tls)
  for (const [name, value] of [
    ['AZURE_AD_TENANT_ID', candidate.entra.tenantId],
    ['AZURE_AD_CLIENT_ID', candidate.entra.clientId],
    ['ADMIN_OID', candidate.entra.adminOid],
    ['MARQUEE_BOOTSTRAP_ADMIN_OID', candidate.entra.bootstrapAdminOid],
    ['WATCHTOWER_WORKLOAD_TENANT_ID', candidate.entra.workloads.watchtower.tenantId],
    ['WATCHTOWER_CLIENT_ID', candidate.entra.workloads.watchtower.clientId],
    ['PRISM_CLIENT_ID', candidate.entra.workloads.prism.clientId],
  ]) {
    if (value && !guid.test(value)) throw new Error(`${name} must be a GUID when configured`)
  }
  if (candidate.entra.audience) {
    const allowedAudiences = new Set([
      candidate.entra.clientId,
      `api://${candidate.entra.clientId}`,
    ])
    if (!candidate.entra.clientId || !allowedAudiences.has(candidate.entra.audience)) {
      throw new Error(
        'AZURE_AD_AUDIENCE must match the Marquee client ID or identifier URI',
      )
    }
  }
  resolveAdminOid(
    candidate.entra.adminOid,
    candidate.entra.bootstrapAdminOid,
    false,
  )
  if (candidate.production) {
    assertRuntimeStorage(candidate, env)
  }
}

export function assertRuntimeStorage(
  candidate: Pick<MarqueeConfig, 'databasePath' | 'artifactRoot'>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const ephemeralSmoke = env.CI === 'true' && env.MARQUEE_EPHEMERAL_SMOKE === 'true'
  const authority = ephemeralSmoke ? '/tmp' : '/home/data'
  for (const [name, target] of [
    ['DB_PATH', candidate.databasePath],
    ['MARQUEE_ARTIFACT_ROOT', candidate.artifactRoot],
  ] satisfies Array<readonly [string, string]>) {
    if (!path.isAbsolute(target)) throw new Error(`${name} must be an absolute path in production`)
    const directory = name === 'DB_PATH' ? path.dirname(target) : target
    const normalizedAuthority = path.resolve(authority)
    const normalizedDirectory = path.resolve(directory)
    if (
      normalizedDirectory !== normalizedAuthority
      && !normalizedDirectory.startsWith(`${normalizedAuthority}${path.sep}`)
    ) {
      throw new Error(`${name} must remain under ${authority}`)
    }
    mkdirSync(directory, { recursive: true })
    const resolvedAuthority = realpathSync(authority)
    const resolvedDirectory = realpathSync(directory)
    if (
      resolvedDirectory !== resolvedAuthority
      && !resolvedDirectory.startsWith(`${resolvedAuthority}${path.sep}`)
    ) {
      throw new Error(`${name} must remain under ${authority}`)
    }
    accessSync(resolvedDirectory, constants.W_OK)
    if (name === 'DB_PATH' && existsSync(target)) {
      const resolvedTarget = realpathSync(target)
      if (!resolvedTarget.startsWith(`${resolvedAuthority}${path.sep}`)) {
        throw new Error(`${name} must remain under ${authority}`)
      }
    }
  }
}

export function resolveAdminOid(
  adminOid: string,
  bootstrapAdminOid: string,
  required: boolean,
) {
  const canonicalAdmin = adminOid.trim().toLowerCase()
  const canonicalBootstrap = bootstrapAdminOid.trim().toLowerCase()
  if (canonicalAdmin && !guid.test(canonicalAdmin)) throw new Error('ADMIN_OID must be a GUID')
  if (canonicalBootstrap && !guid.test(canonicalBootstrap)) {
    throw new Error('MARQUEE_BOOTSTRAP_ADMIN_OID must be a GUID')
  }
  const resolved = canonicalAdmin || canonicalBootstrap
  if (required && !resolved) {
    throw new Error(
      'Production requires ADMIN_OID or explicit MARQUEE_BOOTSTRAP_ADMIN_OID',
    )
  }
  return resolved
}

export function publicConfigSummary() {
  const plexTransport = plexTlsMode(config.plex.baseUrl, config.plex.tls)
  return {
    database: { path: config.databasePath, journalMode: 'delete' },
    providers: {
      plex: Boolean(config.plex.token),
      tautulli: Boolean(config.tautulli.apiKey),
      omdb: Boolean(config.omdbApiKey),
      anthropic: Boolean(config.anthropicApiKey),
      playlistModel: Boolean(config.playlistModel.endpoint && config.playlistModel.apiKey),
      sonarrIngest: Boolean(config.sonarrIngestToken),
    },
    contracts: {
      watchtower: watchtowerWorkloadConfigured(config),
      prism: Boolean(config.entra.workloads.prism.clientId),
    },
    transport: { plex: plexTransport },
  }

}

export function userAuthenticationConfigured(candidate: MarqueeConfig = config) {
  return guid.test(candidate.entra.tenantId)
    && guid.test(candidate.entra.clientId)
    && new Set([
      candidate.entra.clientId,
      `api://${candidate.entra.clientId}`,
    ]).has(candidate.entra.audience)
}

export function watchtowerWorkloadConfigured(candidate: MarqueeConfig = config) {
  const watchtower = candidate.entra.workloads.watchtower
  return guid.test(watchtower.tenantId)
    && Boolean(watchtower.audience)
    && guid.test(watchtower.clientId)
    && Boolean(watchtower.role)
}

export function adminIdentityConfigured(candidate: MarqueeConfig = config) {
  return Boolean(resolveAdminOid(
    candidate.entra.adminOid,
    candidate.entra.bootstrapAdminOid,
    false,
  ))
}

export function frontendRuntimeConfig(candidate: MarqueeConfig = config) {
  if (!userAuthenticationConfigured(candidate)) {
    throw new Error('Marquee user login is not configured')
  }
  return {
    entraTenantId: candidate.entra.tenantId,
    entraClientId: candidate.entra.clientId,
    entraAudience: candidate.entra.audience,
    entraApiScope: `api://${candidate.entra.clientId}/${candidate.entra.userScope}`,
  }
}
