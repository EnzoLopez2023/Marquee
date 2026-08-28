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

const production = process.env.NODE_ENV === 'production'
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const guidEnv = (value: string | undefined) => (value || '').trim().toLowerCase()
const audienceEnv = (value: string | undefined, fallback: string) => {
  const configured = (value || fallback).trim()
  return guid.test(configured) ? configured.toLowerCase() : configured
}

export const config = Object.freeze({
  production,
  port: integer(process.env.PORT, 3001, 1, 65_535),
  databasePath: production
    ? '/home/data/marquee.db'
    : process.env.DB_PATH || path.resolve('marquee.db'),
  sqliteBusyTimeoutMs: integer(process.env.SQLITE_BUSY_TIMEOUT_MS, 5_000, 250, 15_000),
  entra: {
    tenantId: guidEnv(process.env.AZURE_AD_TENANT_ID),
    clientId: guidEnv(process.env.AZURE_AD_CLIENT_ID),
    audience: audienceEnv(process.env.AZURE_AD_AUDIENCE, guidEnv(process.env.AZURE_AD_CLIENT_ID)),
    adminOid: guidEnv(process.env.ADMIN_OID),
    bootstrapAdminOid: guidEnv(process.env.MARQUEE_BOOTSTRAP_ADMIN_OID),
    userScope: 'Marquee.User',
    workloads: {
      watchtower: {
        clientId: guidEnv(process.env.WATCHTOWER_CLIENT_ID),
        role: process.env.WATCHTOWER_APP_ROLE || 'Marquee.Watchtower.MediaHealth.Read',
      },
      prism: {
        clientId: guidEnv(process.env.PRISM_CLIENT_ID),
        readRole: process.env.PRISM_READ_APP_ROLE || 'Marquee.Prism.Media.Read',
        writeRole: process.env.PRISM_WRITE_APP_ROLE || 'Marquee.Prism.Media.Write',
      },
    },
  },
  plex: {
    baseUrl: (process.env.PLEX_BASE_URL || 'https://localhost:32400').replace(/\/$/, ''),
    token: process.env.PLEX_TOKEN || '',
    librarySection: process.env.PLEX_LIBRARY_SECTION || '9',
    tls: {
      insecure: process.env.PLEX_TLS_INSECURE === 'true',
      caFile: process.env.PLEX_TLS_CA_FILE || '',
      certificateSha256: (process.env.PLEX_TLS_CERT_SHA256 || '')
        .replaceAll(':', '')
        .toLowerCase(),
    },
  },
  tautulli: {
    url: (process.env.TAUTULLI_URL || 'http://localhost:8181').replace(/\/$/, ''),
    apiKey: process.env.TAUTULLI_API_KEY || '',
  },
  omdbApiKey: process.env.OMDB_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  playlistModel: {
    endpoint: (process.env.VIBE_OPENAI_ENDPOINT || '').replace(/\/$/, ''),
    apiKey: process.env.VIBE_OPENAI_API_KEY || '',
    deployment: process.env.VIBE_OPENAI_DEPLOYMENT || 'gpt-5.4',
  },
  sonarrIngestToken: process.env.SONARR_INGEST_TOKEN || '',
})

export function validateConfig(): void {
  const missing = [
    ['AZURE_AD_TENANT_ID', config.entra.tenantId],
    ['AZURE_AD_CLIENT_ID', config.entra.clientId],
    ['AZURE_AD_AUDIENCE', config.entra.audience],
    ['WATCHTOWER_CLIENT_ID', config.entra.workloads.watchtower.clientId],
    ['PRISM_CLIENT_ID', config.entra.workloads.prism.clientId],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (config.production && missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(', ')}`)
  }
  if (!canonicalPlexId(config.plex.librarySection)) {
    throw new Error('PLEX_LIBRARY_SECTION must be a canonical positive integer')
  }
  assertPlexTlsConfiguration(config.plex.baseUrl, config.plex.tls)
  if (config.production) {
    for (const [name, value] of [
      ['AZURE_AD_TENANT_ID', config.entra.tenantId],
      ['AZURE_AD_CLIENT_ID', config.entra.clientId],
      ['WATCHTOWER_CLIENT_ID', config.entra.workloads.watchtower.clientId],
      ['PRISM_CLIENT_ID', config.entra.workloads.prism.clientId],
    ]) {
      if (!value || !guid.test(value)) throw new Error(`${name} must be a GUID`)
    }
    resolveAdminOid(
      config.entra.adminOid,
      config.entra.bootstrapAdminOid,
      true,
    )
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
      watchtower: Boolean(config.entra.workloads.watchtower.clientId),
      prism: Boolean(config.entra.workloads.prism.clientId),
    },
    transport: { plex: plexTransport },
  }

}

export function frontendRuntimeConfig() {
  return {
    entraTenantId: config.entra.tenantId,
    entraClientId: config.entra.clientId,
    entraApiScope: `api://${config.entra.clientId}/${config.entra.userScope}`,
  }
}
