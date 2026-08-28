#!/usr/bin/env node
// Marquee Sonarr agent - runs beside Sonarr on the LAN, reads the v3 API, and
// pushes a sanitized snapshot outbound to Marquee. The Sonarr API key never
// leaves this host and Marquee exposes no Sonarr write operations.
//
// Config: sonarr-agent.config.json next to this file (gitignored), or env vars.
//
//   marqueeUrl      MARQUEE_URL         e.g. https://marquee.nintek.com
//   ingestToken     SONARR_INGEST_TOKEN shared token configured in Marquee
//   sonarrUrl       SONARR_URL           default http://192.168.1.52:8989
//   sonarrApiKey    SONARR_API_KEY       Sonarr Settings -> General -> Security
//   pollMinutes     POLL_MINUTES         fast operational poll, default 2
//   fullPollMinutes FULL_POLL_MINUTES    exhaustive library poll, default 30
//
// Run once:      node sonarr-agent.mjs --once
// Verify access: node sonarr-agent.mjs --check [--config candidate-config.json]
// Drain only:    node sonarr-agent.mjs --drain-only
// Install task:  see install-task.ps1

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createDeliveryQueue } from '../agentDelivery.mjs'

const AGENT_BUILD = 3
const SNAPSHOT_SCHEMA = 1
const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(HERE, 'sonarr-agent.config.json')
let deliveryQueue
function getDeliveryQueue() {
  if (!deliveryQueue) {
    deliveryQueue = createDeliveryQueue({
      filePath: join(HERE, 'sonarr-delivery.ndjson'),
      source: 'sonarr',
      onStatus: (message) => console.log(`[delivery] ${message}`),
    })
  }
  return deliveryQueue
}
const args = new Set(process.argv.slice(2))

let currentLogLevel = 20
let shipLogs = true
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

function emit(level, ...parts) {
  if ((LOG_LEVELS[level] ?? 20) < currentLogLevel) return
  const message = sanitizeAgentLogMessage(parts.map((part) => (
    typeof part === 'string' ? part : JSON.stringify(part)
  )).join(' '))
  const ts = Date.now()
  console.log(`[${new Date(ts).toISOString()}] ${level.toUpperCase()} ${message}`)
  if (shipLogs) {
    try {
      getDeliveryQueue().enqueue({
        path: '/api/sonarr/agent-logs/ingest',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'sonarr', lines: [{ ts, level, message }] }),
        timeoutMs: 30_000,
        batchKey: 'sonarr-agent-logs',
        batchField: 'lines',
        maxBatchItems: 500,
      })
    } catch (error) {
      console.log(`[delivery] could not persist log line: ${error.message}`)
    }
  }
}

const log = (...parts) => emit('info', ...parts)
const debug = (...parts) => emit('debug', ...parts)
const warn = (...parts) => emit('warn', ...parts)
const fail = (...parts) => emit('error', ...parts)

function isStrictLoopbackHttpUrl(raw, url) {
  const authority = String(raw).trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]
  if (!authority || authority.includes('@')) return false
  const host = authority.replace(/:\d+$/, '')
  if (/^localhost$/i.test(host)) return url.hostname === 'localhost'
  if (host === '[::1]') return url.hostname === '[::1]'
  return host === url.hostname
    && /^127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/.test(host)
}

export function normalizeMarqueeUrl(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new Error('marqueeUrl must be an absolute HTTPS URL')
  }
  if (url.username || url.password) {
    throw new Error('marqueeUrl must not contain credentials')
  }
  if (url.protocol === 'http:' && !isStrictLoopbackHttpUrl(raw, url)) {
    throw new Error('marqueeUrl must use HTTPS unless it is localhost, 127.0.0.0/8, or [::1]')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('marqueeUrl must use HTTPS')
  }
  return url.href.replace(/\/$/, '')
}

export function loadConfig(configPath = CONFIG_PATH) {
  let file = {}
  try {
    file = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    if (error.code === 'ENOENT' && configPath !== CONFIG_PATH) {
      throw new Error(`Could not read requested config ${configPath}`)
    }
    if (error.code !== 'ENOENT') {
      console.error(`[config] Could not read ${configPath}: ${error.message}`)
    }
  }

  const pick = (key, env, fallback) => file[key] ?? process.env[env] ?? fallback
  const config = {
    marqueeUrl: (() => {
      const value = String(pick('marqueeUrl', 'MARQUEE_URL', file.hearthUrl ?? process.env.HEARTH_URL ?? ''))
      return value ? normalizeMarqueeUrl(value) : ''
    })(),
    ingestToken: String(pick('ingestToken', 'SONARR_INGEST_TOKEN', '')),
    sonarrUrl: String(pick('sonarrUrl', 'SONARR_URL', 'http://192.168.1.52:8989')).replace(/\/+$/, ''),
    sonarrApiKey: String(pick('sonarrApiKey', 'SONARR_API_KEY', '')),
    pollMinutes: Math.max(1, Number(pick('pollMinutes', 'POLL_MINUTES', 2)) || 2),
    fullPollMinutes: Math.max(5, Number(pick('fullPollMinutes', 'FULL_POLL_MINUTES', 30)) || 30),
    requestTimeoutSeconds: Math.max(5, Number(pick('requestTimeoutSeconds', 'REQUEST_TIMEOUT_SECONDS', 30)) || 30),
    logLevel: String(pick('logLevel', 'LOG_LEVEL', 'info')).toLowerCase(),
    shipLogs: String(pick('shipLogs', 'SHIP_LOGS', 'true')).toLowerCase() !== 'false',
  }

  currentLogLevel = LOG_LEVELS[config.logLevel] ?? LOG_LEVELS.info
  shipLogs = config.shipLogs
  return config
}

function assertConfig(config, forCheck = false) {
  const missing = []
  if (!config.sonarrUrl) missing.push('sonarrUrl / SONARR_URL')
  if (!config.sonarrApiKey) missing.push('sonarrApiKey / SONARR_API_KEY')
  if (!forCheck && !config.marqueeUrl) missing.push('marqueeUrl / MARQUEE_URL')
  if (!forCheck && !config.ingestToken) missing.push('ingestToken / SONARR_INGEST_TOKEN')
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`)
}

function redactedUrl(raw) {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return '(invalid Sonarr URL)'
  }
}

function countOf(value) {
  if (Array.isArray(value)) return value.length
  if (Array.isArray(value?.records)) return value.records.length
  if (value && typeof value === 'object') return Object.keys(value).length
  return value == null ? 0 : 1
}

async function sonarrGet(config, path, query = {}) {
  const url = new URL(`${config.sonarrUrl}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': config.sonarrApiKey,
      'User-Agent': `Marquee-Sonarr-Agent/${AGENT_BUILD}`,
    },
    signal: AbortSignal.timeout(config.requestTimeoutSeconds * 1000),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 160)}`)
  }
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${path} returned a non-JSON response`)
  }
}

async function sonarrGetText(config, path, query = {}) {
  const url = new URL(`${config.sonarrUrl}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'X-Api-Key': config.sonarrApiKey,
      'User-Agent': `Marquee-Sonarr-Agent/${AGENT_BUILD}`,
    },
    signal: AbortSignal.timeout(config.requestTimeoutSeconds * 1000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return text
}

async function paged(config, path, query = {}, maxRecords = 20_000) {
  const first = await sonarrGet(config, path, {
    page: 1,
    pageSize: Math.min(1000, maxRecords),
    ...query,
  })
  if (!first || !Array.isArray(first.records)) return first

  const records = [...first.records]
  const totalRecords = Math.min(Number(first.totalRecords) || records.length, maxRecords)
  const pageSize = Math.max(1, Number(first.pageSize) || 1000)
  const pages = Math.ceil(totalRecords / pageSize)

  for (let page = 2; page <= pages && records.length < totalRecords; page += 1) {
    const next = await sonarrGet(config, path, { page, pageSize, ...query })
    if (!Array.isArray(next?.records) || !next.records.length) break
    records.push(...next.records)
  }

  return {
    ...first,
    page: 1,
    pageSize: records.length,
    totalRecords: Number(first.totalRecords) || records.length,
    records: records.slice(0, maxRecords),
    truncated: Number(first.totalRecords) > maxRecords,
  }
}

function redactedText(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/((?:api[_-]?key|apikey|token|password|passwd|authorization)\s*[=:]\s*)[^\s,;&]+/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|apikey|token|password)=[^&\s]+)/gi, (match) => {
      const key = match.slice(0, match.indexOf('=') + 1)
      return `${key}[redacted]`
    })
}

const PATH_FIELD = /^(?:appdata|.*(?:paths?|folders?|directory|directories))$/i
const WINDOWS_ABSOLUTE = /(?:(?:^|[^a-z0-9_])[a-z]:[\\/]|\\\\[^\\/\s]+[\\/])/i
const POSIX_ABSOLUTE = /\/[^\s"'<>?#/]+(?:\/[^\s"'<>?#/]+)*/gi
const WEB_ROUTE_PREFIXES = ['/api/', '/signalr/']
const WEB_ROUTE_EXACT = new Set(['/api', '/signalr', '/ping', '/version.json', '/runtime-config.js'])

export function redactAbsoluteFilesystemString(value) {
  const containsFilesystemPath = [...value.matchAll(POSIX_ABSOLUTE)].some((match) => {
    const candidate = match[0]
    const prefix = value.slice(0, match.index ?? 0)
    if (/[a-z][a-z0-9+.-]*:\/$/i.test(prefix)) return false
    return candidate
      && !WEB_ROUTE_EXACT.has(candidate)
      && !WEB_ROUTE_PREFIXES.some((prefix) => candidate.startsWith(prefix))
  })
  return WINDOWS_ABSOLUTE.test(value) || containsFilesystemPath
    ? '[redacted filesystem path]'
    : value
}

export function sanitizeAgentLogMessage(value) {
  return redactAbsoluteFilesystemString(redactedText(String(value)))
}

export function sanitizeSnapshotForDelivery(value) {
  if (Array.isArray(value)) return value.map(sanitizeSnapshotForDelivery)
  if (typeof value === 'string') return redactAbsoluteFilesystemString(value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PATH_FIELD.test(key))
      .map(([key, nested]) => [redactAbsoluteFilesystemString(key), sanitizeSnapshotForDelivery(nested)]),
  )
}

function pick(source, keys) {
  const out = {}
  for (const key of keys) {
    if (source?.[key] !== undefined) out[key] = source[key]
  }
  return out
}

const INTEGRATION_FIELDS = [
  'id', 'name', 'enable', 'implementation', 'implementationName',
  'configContract', 'protocol', 'priority', 'tags', 'supportsRss',
  'supportsSearch', 'downloadClientType',
]

function sanitizedIntegration(resource) {
  return pick(resource, INTEGRATION_FIELDS)
}

function sanitizedSchema(resource) {
  return {
    ...sanitizedIntegration(resource),
    fields: Array.isArray(resource?.fields)
      ? resource.fields.map((field) => pick(field, [
        'name', 'label', 'helpText', 'helpLink', 'type', 'advanced',
        'hidden', 'privacy', 'selectOptions', 'selectOptionsProviderAction',
      ]))
      : [],
  }
}

function sanitizedLog(resource) {
  const selected = pick(resource, [
    'id', 'time', 'level', 'logger', 'message', 'exception',
    'exceptionType', 'method', 'threadName',
  ])
  for (const key of ['message', 'exception', 'method']) {
    if (selected[key] !== undefined) selected[key] = redactedText(selected[key])
  }
  return selected
}

function selectedConfig(resource, keys) {
  return pick(resource, ['id', ...keys])
}

export async function collectOne(
  diagnostics,
  key,
  path,
  reader,
  transform = (value) => value,
  previousValue,
  previousDiagnostic,
) {
  const started = Date.now()
  try {
    const raw = await reader()
    const value = transform(raw)
    const collectedAt = Date.now()
    diagnostics.push({
      key,
      path,
      ok: true,
      stale: false,
      count: countOf(value),
      duration_ms: Date.now() - started,
      collected_at: collectedAt,
      last_success_at: collectedAt,
    })
    return value
  } catch (error) {
    diagnostics.push({
      key,
      path,
      ok: false,
      stale: previousValue !== undefined,
      count: countOf(previousValue),
      duration_ms: Date.now() - started,
      collected_at: Date.now(),
      last_success_at: previousDiagnostic?.last_success_at
        ?? (previousDiagnostic?.ok ? previousDiagnostic.collected_at : null),
      error: redactedText(error.message).slice(0, 500),
    })
    warn(`${key} unavailable: ${redactedText(error.message)}`)
    return undefined
  }
}

async function mapLimit(items, concurrency, worker) {
  const output = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return output
}

function assignDefined(target, key, value) {
  if (value !== undefined) target[key] = value
}

export async function collectFast(config, previousData = {}, previousDiagnostics = []) {
  const data = { ...previousData }
  const diagnostics = []
  const previousDiagnosticsByKey = new Map(previousDiagnostics.map((item) => [item.key, item]))
  const now = new Date()
  const calendarStart = new Date(now.getTime() - 7 * 86400_000).toISOString()
  const calendarEnd = new Date(now.getTime() + 28 * 86400_000).toISOString()

  const jobs = [
    ['systemStatus', '/api/v3/system/status', () => sonarrGet(config, '/api/v3/system/status')],
    ['health', '/api/v3/health', () => sonarrGet(config, '/api/v3/health')],
    ['diskSpace', '/api/v3/diskspace', () => sonarrGet(config, '/api/v3/diskspace')],
    ['calendar', '/api/v3/calendar', () => sonarrGet(config, '/api/v3/calendar', {
      start: calendarStart,
      end: calendarEnd,
      unmonitored: true,
      includeSeries: true,
      includeEpisodeFile: true,
      includeEpisodeImages: false,
    })],
    ['queue', '/api/v3/queue', () => paged(config, '/api/v3/queue', {
      sortKey: 'timeleft',
      sortDirection: 'ascending',
      includeUnknownSeriesItems: true,
      includeSeries: true,
      includeEpisode: true,
    }, 5000)],
    ['queueStatus', '/api/v3/queue/status', () => sonarrGet(config, '/api/v3/queue/status')],
    ['history', '/api/v3/history', () => paged(config, '/api/v3/history', {
      sortKey: 'date',
      sortDirection: 'descending',
      includeSeries: true,
      includeEpisode: true,
    }, 2000)],
    ['commands', '/api/v3/command', () => sonarrGet(config, '/api/v3/command')],
    ['tasks', '/api/v3/system/task', () => sonarrGet(config, '/api/v3/system/task')],
    ['backups', '/api/v3/system/backup', () => sonarrGet(config, '/api/v3/system/backup')],
    ['updates', '/api/v3/update', () => sonarrGet(config, '/api/v3/update')],
    ['logs', '/api/v3/log', () => paged(config, '/api/v3/log', {
      sortKey: 'time',
      sortDirection: 'descending',
    }, 500), (page) => ({
      ...page,
      records: Array.isArray(page?.records) ? page.records.map(sanitizedLog) : [],
    })],
    ['logFiles', '/api/v3/log/file', () => sonarrGet(config, '/api/v3/log/file')],
    ['updateLogFiles', '/api/v3/log/file/update', () => sonarrGet(config, '/api/v3/log/file/update')],
    ['rootFolders', '/api/v3/rootfolder', () => sonarrGet(config, '/api/v3/rootfolder')],
  ]

  await Promise.all(jobs.map(async ([key, path, reader, transform]) => {
    assignDefined(data, key, await collectOne(
      diagnostics,
      key,
      path,
      reader,
      transform,
      previousData[key],
      previousDiagnosticsByKey.get(key),
    ))
  }))
  return { data, diagnostics }
}

async function collectSeriesDetail(config, series, diagnostics, previousData, previousDiagnosticsByKey) {
  const seriesDiagnostic = diagnostics.find((item) => item.key === 'series')
  if (!seriesDiagnostic?.ok) {
    return {
      episodesBySeries: previousData.episodesBySeries ?? {},
      episodeFilesBySeries: previousData.episodeFilesBySeries ?? {},
    }
  }
  if (!Array.isArray(series) || !series.length) {
    return {
      episodesBySeries: {},
      episodeFilesBySeries: {},
    }
  }

  const started = Date.now()
  let episodeFailures = 0
  let fileFailures = 0
  const episodesBySeries = {}
  const episodeFilesBySeries = {}

  await mapLimit(series, 6, async (item) => {
    const id = Number(item?.id)
    if (!Number.isInteger(id) || id <= 0) return
    const key = String(id)
    const [episodes, files] = await Promise.all([
      sonarrGet(config, '/api/v3/episode', {
        seriesId: id,
        includeSeries: false,
        includeEpisodeFile: true,
        includeImages: false,
      }).catch((error) => {
        episodeFailures += 1
        debug(`episodes for series ${id} unavailable: ${redactedText(error.message)}`)
        return previousData.episodesBySeries?.[key]
      }),
      sonarrGet(config, '/api/v3/episodefile', { seriesId: id }).catch((error) => {
        fileFailures += 1
        debug(`episode files for series ${id} unavailable: ${redactedText(error.message)}`)
        return previousData.episodeFilesBySeries?.[key]
      }),
    ])
    if (Array.isArray(episodes)) episodesBySeries[key] = episodes
    if (Array.isArray(files)) episodeFilesBySeries[key] = files
  })

  const collectedAt = Date.now()
  const failed = episodeFailures > 0 || fileFailures > 0
  const previousDiagnostic = previousDiagnosticsByKey.get('seriesDetail')
  diagnostics.push({
    key: 'seriesDetail',
    path: '/api/v3/episode + /api/v3/episodefile',
    ok: !failed,
    stale: failed && (
      Object.keys(previousData.episodesBySeries ?? {}).length > 0
      || Object.keys(previousData.episodeFilesBySeries ?? {}).length > 0
    ),
    count: Object.values(episodesBySeries).reduce((sum, rows) => sum + rows.length, 0),
    duration_ms: Date.now() - started,
    collected_at: collectedAt,
    last_success_at: failed
      ? previousDiagnostic?.last_success_at
        ?? (previousDiagnostic?.ok ? previousDiagnostic.collected_at : null)
      : collectedAt,
    ...(failed
      ? { error: `${episodeFailures} episode reads and ${fileFailures} file reads failed` }
      : {}),
  })

  return { episodesBySeries, episodeFilesBySeries }
}

export async function collectFull(config, previousData = {}, previousDiagnostics = []) {
  const data = { ...previousData }
  const diagnostics = []
  const previousDiagnosticsByKey = new Map(previousDiagnostics.map((item) => [item.key, item]))

  const jobs = [
    ['series', '/api/v3/series', () => sonarrGet(config, '/api/v3/series', { includeSeasonImages: false })],
    ['missing', '/api/v3/wanted/missing', () => paged(config, '/api/v3/wanted/missing', {
      sortKey: 'airDateUtc',
      sortDirection: 'descending',
      includeSeries: true,
      includeImages: false,
      monitored: true,
    })],
    ['cutoff', '/api/v3/wanted/cutoff', () => paged(config, '/api/v3/wanted/cutoff', {
      sortKey: 'airDateUtc',
      sortDirection: 'descending',
      includeSeries: true,
      includeEpisodeFile: true,
      includeImages: false,
      monitored: true,
    })],
    ['blocklist', '/api/v3/blocklist', () => paged(config, '/api/v3/blocklist', {
      sortKey: 'date',
      sortDirection: 'descending',
    }, 2000)],
    ['autoTagging', '/api/v3/autotagging', () => sonarrGet(config, '/api/v3/autotagging')],
    ['customFilters', '/api/v3/customfilter', () => sonarrGet(config, '/api/v3/customfilter')],
    ['customFormats', '/api/v3/customformat', () => sonarrGet(config, '/api/v3/customformat')],
    ['delayProfiles', '/api/v3/delayprofile', () => sonarrGet(config, '/api/v3/delayprofile')],
    ['importListExclusions', '/api/v3/importlistexclusion/paged', () => paged(config, '/api/v3/importlistexclusion/paged', {}, 10_000)],
    ['indexerFlags', '/api/v3/indexerflag', () => sonarrGet(config, '/api/v3/indexerflag')],
    ['languages', '/api/v3/language', () => sonarrGet(config, '/api/v3/language')],
    ['languageProfiles', '/api/v3/languageprofile', () => sonarrGet(config, '/api/v3/languageprofile')],
    ['qualityDefinitions', '/api/v3/qualitydefinition', () => sonarrGet(config, '/api/v3/qualitydefinition')],
    ['qualityDefinitionLimits', '/api/v3/qualitydefinition/limits', () => sonarrGet(config, '/api/v3/qualitydefinition/limits')],
    ['qualityProfiles', '/api/v3/qualityprofile', () => sonarrGet(config, '/api/v3/qualityprofile')],
    ['releaseProfiles', '/api/v3/releaseprofile', () => sonarrGet(config, '/api/v3/releaseprofile')],
    ['remotePathMappings', '/api/v3/remotepathmapping', () => sonarrGet(config, '/api/v3/remotepathmapping')],
    ['tags', '/api/v3/tag', () => sonarrGet(config, '/api/v3/tag')],
    ['tagDetails', '/api/v3/tag/detail', () => sonarrGet(config, '/api/v3/tag/detail')],
    ['downloadClients', '/api/v3/downloadclient', () => sonarrGet(config, '/api/v3/downloadclient'), (rows) => rows.map(sanitizedIntegration)],
    ['indexers', '/api/v3/indexer', () => sonarrGet(config, '/api/v3/indexer'), (rows) => rows.map(sanitizedIntegration)],
    ['importLists', '/api/v3/importlist', () => sonarrGet(config, '/api/v3/importlist'), (rows) => rows.map(sanitizedIntegration)],
    ['notifications', '/api/v3/notification', () => sonarrGet(config, '/api/v3/notification'), (rows) => rows.map(sanitizedIntegration)],
    ['metadataConsumers', '/api/v3/metadata', () => sonarrGet(config, '/api/v3/metadata'), (rows) => rows.map(sanitizedIntegration)],
    ['downloadClientSchemas', '/api/v3/downloadclient/schema', () => sonarrGet(config, '/api/v3/downloadclient/schema'), (rows) => rows.map(sanitizedSchema)],
    ['indexerSchemas', '/api/v3/indexer/schema', () => sonarrGet(config, '/api/v3/indexer/schema'), (rows) => rows.map(sanitizedSchema)],
    ['importListSchemas', '/api/v3/importlist/schema', () => sonarrGet(config, '/api/v3/importlist/schema'), (rows) => rows.map(sanitizedSchema)],
    ['notificationSchemas', '/api/v3/notification/schema', () => sonarrGet(config, '/api/v3/notification/schema'), (rows) => rows.map(sanitizedSchema)],
    ['metadataSchemas', '/api/v3/metadata/schema', () => sonarrGet(config, '/api/v3/metadata/schema'), (rows) => rows.map(sanitizedSchema)],
    ['customFormatSchema', '/api/v3/customformat/schema', () => sonarrGet(config, '/api/v3/customformat/schema')],
    ['qualityProfileSchema', '/api/v3/qualityprofile/schema', () => sonarrGet(config, '/api/v3/qualityprofile/schema')],
    ['languageProfileSchema', '/api/v3/languageprofile/schema', () => sonarrGet(config, '/api/v3/languageprofile/schema')],
    ['mediaManagementConfig', '/api/v3/config/mediamanagement', () => sonarrGet(config, '/api/v3/config/mediamanagement'), (row) => selectedConfig(row, [
      'autoUnmonitorPreviouslyDownloadedEpisodes', 'recycleBin', 'recycleBinCleanupDays',
      'downloadPropersAndRepacks', 'createEmptySeriesFolders', 'deleteEmptyFolders',
      'fileDate', 'rescanAfterRefresh', 'allowFingerprinting', 'setPermissionsLinux',
      'chmodFolder', 'chownGroup', 'skipFreeSpaceCheckWhenImporting',
      'minimumFreeSpaceWhenImporting', 'copyUsingHardlinks', 'importExtraFiles',
      'extraFileExtensions',
    ])],
    ['namingConfig', '/api/v3/config/naming', () => sonarrGet(config, '/api/v3/config/naming')],
    ['uiConfig', '/api/v3/config/ui', () => sonarrGet(config, '/api/v3/config/ui'), (row) => selectedConfig(row, [
      'firstDayOfWeek', 'calendarWeekColumnHeader', 'shortDateFormat', 'longDateFormat',
      'timeFormat', 'showRelativeDates', 'enableColorImpairedMode',
      'seriesInfoLanguage', 'uiLanguage', 'theme',
    ])],
    ['hostConfig', '/api/v3/config/host', () => sonarrGet(config, '/api/v3/config/host'), (row) => selectedConfig(row, [
      'bindAddress', 'port', 'sslPort', 'enableSsl', 'launchBrowser',
      'authenticationMethod', 'authenticationRequired', 'analyticsEnabled',
      'branch', 'logLevel', 'consoleLogLevel', 'updateMechanism', 'instanceName',
      'urlBase',
    ])],
    ['downloadClientConfig', '/api/v3/config/downloadclient', () => sonarrGet(config, '/api/v3/config/downloadclient'), (row) => selectedConfig(row, [
      'downloadClientWorkingFolders', 'enableCompletedDownloadHandling',
      'autoRedownloadFailed', 'autoRedownloadFailedFromInteractiveSearch',
    ])],
    ['indexerConfig', '/api/v3/config/indexer', () => sonarrGet(config, '/api/v3/config/indexer'), (row) => selectedConfig(row, [
      'minimumAge', 'retention', 'maximumSize', 'rssSyncInterval',
    ])],
    ['importListConfig', '/api/v3/config/importlist', () => sonarrGet(config, '/api/v3/config/importlist'), (row) => selectedConfig(row, [
      'listSyncLevel', 'listSyncTag', 'listSyncInterval',
    ])],
    ['localization', '/api/v3/localization', () => sonarrGet(config, '/api/v3/localization')],
    ['localizationLanguage', '/api/v3/localization/language', () => sonarrGet(config, '/api/v3/localization/language')],
    ['systemRoutes', '/api/v3/system/routes', () => sonarrGetText(config, '/api/v3/system/routes')],
    ['duplicateRoutes', '/api/v3/system/routes/duplicate', () => sonarrGet(config, '/api/v3/system/routes/duplicate')],
    ['apiInfo', '/api', () => sonarrGet(config, '/api')],
    ['ping', '/ping', () => sonarrGet(config, '/ping')],
  ]

  await Promise.all(jobs.map(async ([key, path, reader, transform]) => {
    assignDefined(data, key, await collectOne(
      diagnostics,
      key,
      path,
      reader,
      transform,
      previousData[key],
      previousDiagnosticsByKey.get(key),
    ))
  }))

  const detail = await collectSeriesDetail(
    config,
    data.series,
    diagnostics,
    previousData,
    previousDiagnosticsByKey,
  )
  data.episodesBySeries = detail.episodesBySeries
  data.episodeFilesBySeries = detail.episodeFilesBySeries

  return { data, diagnostics }
}

function recordsOf(value) {
  return Array.isArray(value?.records) ? value.records : Array.isArray(value) ? value : []
}

function dayKey(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function countBy(rows, keyFor, limit = 12) {
  const counts = new Map()
  for (const row of rows) {
    const key = keyFor(row)
    if (key === null || key === undefined || key === '') continue
    const label = String(key)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }))
}

function historyTimeline(historyRows) {
  const days = new Map()
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10)
    days.set(date, { date, grabbed: 0, imported: 0, failed: 0, deleted: 0, other: 0 })
  }
  for (const row of historyRows) {
    const date = dayKey(row?.date)
    if (!date || !days.has(date)) continue
    const event = String(row?.eventType ?? '').toLowerCase()
    const bucket = days.get(date)
    if (event === 'grabbed') bucket.grabbed += 1
    else if (event.includes('import')) bucket.imported += 1
    else if (event.includes('fail')) bucket.failed += 1
    else if (event.includes('delete')) bucket.deleted += 1
    else bucket.other += 1
  }
  return [...days.values()]
}

function deriveInsights(data, diagnostics) {
  const series = recordsOf(data.series)
  const queue = recordsOf(data.queue)
  const history = recordsOf(data.history)
  const missing = recordsOf(data.missing)
  const cutoff = recordsOf(data.cutoff)
  const health = recordsOf(data.health)
  const calendar = recordsOf(data.calendar)
  const disks = recordsOf(data.diskSpace)
  const episodeGroups = Object.values(data.episodesBySeries ?? {})
  const allEpisodes = episodeGroups.flat()

  const fromEpisodeDetail = allEpisodes.length > 0
  const episodeCount = fromEpisodeDetail
    ? allEpisodes.length
    : series.reduce((sum, item) => sum + (Number(item?.statistics?.totalEpisodeCount) || 0), 0)
  const episodeFileCount = fromEpisodeDetail
    ? allEpisodes.filter((episode) => episode?.hasFile).length
    : series.reduce((sum, item) => sum + (Number(item?.statistics?.episodeFileCount) || 0), 0)
  const monitoredEpisodeCount = fromEpisodeDetail
    ? allEpisodes.filter((episode) => episode?.monitored).length
    : series.reduce((sum, item) => sum + (Number(item?.statistics?.episodeCount) || 0), 0)
  const librarySizeBytes = series.reduce(
    (sum, item) => sum + (Number(item?.statistics?.sizeOnDisk) || 0),
    0,
  )
  const freeSpaceBytes = disks.reduce((sum, item) => sum + (Number(item?.freeSpace) || 0), 0)

  const incompleteSeries = series
    .map((item) => ({
      id: item.id,
      title: item.title,
      network: item.network ?? null,
      status: item.status ?? null,
      monitored: Boolean(item.monitored),
      episodeCount: Number(item?.statistics?.episodeCount) || 0,
      episodeFileCount: Number(item?.statistics?.episodeFileCount) || 0,
      percentOfEpisodes: Number(item?.statistics?.percentOfEpisodes) || 0,
      sizeOnDisk: Number(item?.statistics?.sizeOnDisk) || 0,
      nextAiring: item.nextAiring ?? null,
    }))
    .filter((item) => item.monitored && item.percentOfEpisodes < 100)
    .sort((a, b) => a.percentOfEpisodes - b.percentOfEpisodes || a.title.localeCompare(b.title))
    .slice(0, 50)

  const now = Date.now()
  const last24h = history.filter((item) => {
    const timestamp = new Date(item?.date).getTime()
    return Number.isFinite(timestamp) && timestamp >= now - 86400_000
  })
  const eventCount = (needle) => last24h.filter(
    (item) => String(item?.eventType ?? '').toLowerCase().includes(needle),
  ).length

  return {
    metrics: {
      seriesCount: series.length,
      monitoredSeriesCount: series.filter((item) => item?.monitored).length,
      episodeCount,
      episodeFileCount,
      monitoredEpisodeCount,
      missingCount: Number(data.missing?.totalRecords) || missing.length,
      cutoffUnmetCount: Number(data.cutoff?.totalRecords) || cutoff.length,
      queueCount: Number(data.queue?.totalRecords) || queue.length,
      healthIssueCount: health.length,
      librarySizeBytes,
      freeSpaceBytes,
    },
    pipeline: {
      wanted: Number(data.missing?.totalRecords) || missing.length,
      queued: Number(data.queue?.totalRecords) || queue.length,
      grabbed24h: eventCount('grab'),
      imported24h: eventCount('import'),
      failed24h: eventCount('fail'),
      availableEpisodes: episodeFileCount,
    },
    breakdowns: {
      seriesStatus: countBy(series, (item) => item?.status ?? 'unknown'),
      networks: countBy(series, (item) => item?.network ?? 'Unknown network', 15),
      qualityProfiles: countBy(series, (item) => item?.profileName ?? `Profile ${item?.qualityProfileId ?? '?'}`),
      genres: countBy(series.flatMap((item) => (
        Array.isArray(item?.genres) ? item.genres.map((genre) => ({ genre })) : []
      )), (item) => item.genre, 15),
      historyEvents: countBy(history, (item) => item?.eventType ?? 'unknown'),
      logLevels: countBy(recordsOf(data.logs), (item) => item?.level ?? 'unknown'),
    },
    historyTimeline: historyTimeline(history),
    incompleteSeries,
    upcoming: calendar
      .filter((item) => new Date(item?.airDateUtc ?? item?.airDate).getTime() >= now)
      .sort((a, b) => (
        new Date(a?.airDateUtc ?? a?.airDate).getTime()
        - new Date(b?.airDateUtc ?? b?.airDate).getTime()
      ))
      .slice(0, 40),
    integrations: {
      downloadClients: recordsOf(data.downloadClients).length,
      enabledDownloadClients: recordsOf(data.downloadClients).filter((item) => item?.enable !== false).length,
      indexers: recordsOf(data.indexers).length,
      enabledIndexers: recordsOf(data.indexers).filter((item) => item?.enable !== false).length,
      importLists: recordsOf(data.importLists).length,
      notifications: recordsOf(data.notifications).length,
      metadataConsumers: recordsOf(data.metadataConsumers).length,
    },
    collection: {
      endpointCount: diagnostics.length,
      healthyEndpointCount: diagnostics.filter((item) => item.ok).length,
      failedEndpointCount: diagnostics.filter((item) => !item.ok).length,
    },
  }
}

async function shipPendingLogs(config) {
  if (
    (!shipLogs && getDeliveryQueue().status().pending === 0)
    || !config.marqueeUrl
    || !config.ingestToken
  ) return
  try {
    await getDeliveryQueue().flush({
      baseUrl: config.marqueeUrl,
      token: config.ingestToken,
      maxRequests: 50,
    })
  } catch (error) {
    console.log(`[delivery] log shipping unavailable: ${error.message}`)
  }
}

export async function drainOnly(config, { queue = getDeliveryQueue() } = {}) {
  if (!config.marqueeUrl || !config.ingestToken) {
    throw new Error('Missing configuration: marqueeUrl / MARQUEE_URL, ingestToken / SONARR_INGEST_TOKEN')
  }
  // Do not use emit/log here: shipping a drain status would create a fresh queue
  // entry and make it impossible for an operator to establish quiescence.
  while (queue.status().pending > 0) {
    const before = queue.status().pending
    const result = await queue.flush({
      baseUrl: config.marqueeUrl,
      token: config.ingestToken,
      maxRequests: 50,
    })
    console.log(`[drain] accepted=${result.accepted} dead-lettered=${result.deadLettered} pending=${result.pending}`)
    if (result.pending === 0) return result
    if (result.pending >= before && result.accepted === 0 && result.deadLettered === 0) {
      throw new Error(`delivery queue remains unresolved with ${result.pending} entries`)
    }
  }
  return { accepted: 0, deadLettered: 0, pending: 0 }
}

export async function pushSnapshot(config, snapshot, { queue = getDeliveryQueue() } = {}) {
  const sanitized = sanitizeSnapshotForDelivery(snapshot)
  const compressed = gzipSync(Buffer.from(JSON.stringify(sanitized), 'utf8'))
  const body = JSON.stringify({
    encoding: 'gzip-base64',
    payload: compressed.toString('base64'),
  })

  const deliveryId = queue.enqueue({
    path: '/api/sonarr/ingest',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    timeoutMs: 90_000,
    coalesceKey: 'sonarr-snapshot',
  })
  const result = await queue.flush({
    baseUrl: config.marqueeUrl,
    token: config.ingestToken,
    maxRequests: 50,
  })
  if (result.deadLetteredIds.includes(deliveryId)) {
    throw new Error('Marquee ingest rejected the snapshot permanently; moved it to the delivery dead letter')
  }
  return {
    compressedBytes: compressed.length,
    wireBytes: Buffer.byteLength(body),
    accepted: result.acceptedIds.includes(deliveryId),
    pending: result.pending,
  }
}

export function createCollectionState() {
  return {
    cachedFastData: {},
    cachedFastDiagnostics: [],
    cachedFullData: null,
    cachedFullDiagnostics: [],
    lastFullAt: 0,
    lastFullAttemptAt: null,
  }
}

export async function collectSnapshot(
  config,
  state,
  {
    now = Date.now,
    fastCollector = collectFast,
    fullCollector = collectFull,
  } = {},
) {
  const started = now()
  const fullDue = typeof state.lastFullAttemptAt !== 'number'
    || started - state.lastFullAttemptAt >= config.fullPollMinutes * 60_000

  const fastPromise = fastCollector(config, state.cachedFastData, state.cachedFastDiagnostics)
  const fullPromise = fullDue
    ? (() => {
      state.lastFullAttemptAt = started
      return fullCollector(config, state.cachedFullData ?? {}, state.cachedFullDiagnostics)
    })()
    : Promise.resolve(null)
  const [fast, full] = await Promise.all([fastPromise, fullPromise])

  state.cachedFastData = fast.data
  state.cachedFastDiagnostics = fast.diagnostics
  const fullComplete = Boolean(full)
    && full.diagnostics.length > 0
    && full.diagnostics.every((item) => item.ok)
  if (full) {
    state.cachedFullData = full.data
    state.cachedFullDiagnostics = full.diagnostics
    if (fullComplete) state.lastFullAt = now()
  }

  const data = { ...(state.cachedFullData ?? {}), ...state.cachedFastData }
  const diagnostics = [...state.cachedFullDiagnostics, ...state.cachedFastDiagnostics]
  const failedEndpoints = diagnostics.filter((item) => !item.ok)
  const staleEndpoints = diagnostics.filter((item) => item.stale)
  const sampledAt = now()
  const snapshot = sanitizeSnapshotForDelivery({
    schema: SNAPSHOT_SCHEMA,
    sampled_at: sampledAt,
    agent: {
      build: AGENT_BUILD,
      poll_minutes: config.pollMinutes,
      full_poll_minutes: config.fullPollMinutes,
      full_collected_at: state.lastFullAt || null,
    },
    source: {
      label: data.systemStatus?.instanceName || 'Sonarr',
      host: new URL(config.sonarrUrl).hostname,
      version: data.systemStatus?.version ?? null,
      branch: data.systemStatus?.branch ?? null,
      runtimeVersion: data.systemStatus?.runtimeVersion ?? null,
      databaseType: data.systemStatus?.databaseType ?? null,
      startupPath: data.systemStatus?.startupPath ?? null,
      appData: data.systemStatus?.appData ?? null,
    },
    collection: {
      mode: fullDue ? 'full' : 'fast',
      duration_ms: now() - started,
      endpoints: diagnostics,
      failed_endpoint_count: failedEndpoints.length,
      stale_endpoint_count: staleEndpoints.length,
      full_poll: {
        due: fullDue,
        complete: full
          ? fullComplete
          : state.cachedFullDiagnostics.length > 0
            ? state.cachedFullDiagnostics.every((item) => item.ok)
            : null,
        last_completed_at: state.lastFullAt || null,
        last_attempted_at: state.lastFullAttemptAt,
      },
      unavailable: failedEndpoints.map((item) => ({
        key: item.key,
        path: item.path,
        stale: item.stale,
        last_success_at: item.last_success_at,
        error: item.error,
      })),
    },
    data,
    insights: deriveInsights(data, diagnostics),
  })
  return { snapshot, fullDue, fullComplete }
}

const collectionState = createCollectionState()

async function collectAndPush(config) {
  const started = Date.now()
  const { snapshot, fullDue } = await collectSnapshot(config, collectionState)
  const diagnostics = snapshot.collection.endpoints

  const sizes = await pushSnapshot(config, snapshot)
  log(
    `${sizes.accepted ? 'Pushed' : 'Queued'} ${fullDue ? 'full' : 'fast'} snapshot:`,
    `${snapshot.insights.metrics.seriesCount} series,`,
    `${snapshot.insights.metrics.queueCount} queued,`,
    `${diagnostics.filter((item) => item.ok).length}/${diagnostics.length} endpoints,`,
    `${Math.round(sizes.compressedBytes / 1024)} KiB compressed,`,
    `${Date.now() - started} ms`,
  )
  await shipPendingLogs(config)
}

async function check(config) {
  assertConfig(config)
  const marqueeCheck = fetch(`${config.marqueeUrl}/api/sonarr/agent-check`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.ingestToken}`,
      'User-Agent': `Marquee-Sonarr-Agent/${AGENT_BUILD}`,
    },
    signal: AbortSignal.timeout(config.requestTimeoutSeconds * 1000),
  }).then(async (response) => {
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Marquee agent check returned HTTP ${response.status}: ${text.slice(0, 160)}`)
    }
    try {
      const result = JSON.parse(text)
      if (result?.ok !== true) throw new Error('response did not confirm success')
      return result
    } catch (error) {
      throw new Error(`Marquee agent check returned invalid JSON: ${error.message}`)
    }
  })
  const [ping, status] = await Promise.all([
    sonarrGet(config, '/ping'),
    sonarrGet(config, '/api/v3/system/status'),
    marqueeCheck,
  ])
  console.log(`Sonarr reachable at ${redactedUrl(config.sonarrUrl)}`)
  console.log(`  status: ${ping?.status ?? 'OK'}`)
  console.log(`  instance: ${status?.instanceName ?? 'Sonarr'}`)
  console.log(`  version: ${status?.version ?? 'unknown'} (${status?.branch ?? 'unknown branch'})`)
  console.log(`Marquee ingest ready at ${redactedUrl(config.marqueeUrl)}`)
}

async function main() {
  const configIndex = process.argv.indexOf('--config')
  if (configIndex >= 0 && !process.argv[configIndex + 1]) {
    throw new Error('--config requires a file path')
  }
  const config = loadConfig(configIndex >= 0 ? process.argv[configIndex + 1] : CONFIG_PATH)
  if (args.has('--check')) {
    await check(config)
    return
  }
  if (args.has('--drain-only')) {
    await drainOnly(config)
    return
  }

  assertConfig(config)
  log(`Starting build ${AGENT_BUILD}; Sonarr ${redactedUrl(config.sonarrUrl)} -> Marquee ${config.marqueeUrl}`)
  log(`Fast poll ${config.pollMinutes}m; exhaustive poll ${config.fullPollMinutes}m`)

  if (args.has('--once')) {
    await collectAndPush(config)
    return
  }

  while (true) {
    try {
      await collectAndPush(config)
    } catch (error) {
      fail(redactedText(error.message))
      await shipPendingLogs(config)
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMinutes * 60_000))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[fatal] ${redactedText(error.message)}`)
    process.exitCode = 1
  })
}
