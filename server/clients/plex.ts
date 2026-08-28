import { Agent } from 'undici'
import { readFileSync } from 'node:fs'
import { checkServerIdentity, type PeerCertificate } from 'node:tls'
import { config } from '../config.js'
import { certificateSha256Matches } from '../domain/media/plexTls.js'

const certificatePin = config.plex.tls.certificateSha256
const ca = config.plex.tls.caFile ? readFileSync(config.plex.tls.caFile) : undefined
const verifyServerIdentity = certificatePin
  ? (hostname: string, certificate: PeerCertificate) => {
      const defaultError = checkServerIdentity(hostname, certificate)
      if (defaultError) return defaultError
      if (!certificate.raw) return new Error('Plex certificate did not include raw DER bytes')
      return certificateSha256Matches(certificate.raw, certificatePin)
        ? undefined
        : new Error('Plex certificate SHA-256 pin mismatch')
    }
  : undefined

export const plexDispatcher = new Agent({
  connect: {
    rejectUnauthorized: !config.plex.tls.insecure,
    ...(ca ? { ca } : {}),
    ...(verifyServerIdentity ? { checkServerIdentity: verifyServerIdentity } : {}),
  },
})
const TIMEOUT_MS = 15_000

export class PlexApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestPath: string,
  ) {
    super(`Plex request failed with status ${status}`)
  }
}

export interface PlexRequestOptions {
  method?: string
  formData?: URLSearchParams | FormData | Record<string, string>
  accept?: 'json' | 'xml' | 'image'
  signal?: AbortSignal
}

export async function plexFetch(
  requestPath: string,
  options: PlexRequestOptions = {},
): Promise<Response> {
  if (!config.plex.token) throw new Error('Plex is not configured')
  const url = new URL(requestPath, `${config.plex.baseUrl}/`)
  if (url.origin !== new URL(config.plex.baseUrl).origin) {
    throw new Error('Plex request host is not allowed')
  }
  url.searchParams.set('X-Plex-Token', config.plex.token)
  if (options.accept !== 'xml' && options.accept !== 'image') {
    url.searchParams.set('X-Plex-Container-Format', 'json')
  }
  const body = options.formData && !(options.formData instanceof URLSearchParams)
    && !(options.formData instanceof FormData)
    ? new URLSearchParams(options.formData)
    : options.formData
  return fetch(url, {
    method: options.method || 'GET',
    body,
    dispatcher: plexDispatcher,
    signal: options.signal || AbortSignal.timeout(TIMEOUT_MS),
  } as RequestInit & { dispatcher: Agent })
}

export async function plexJson<T = any>(
  requestPath: string,
  options: PlexRequestOptions = {},
): Promise<T> {
  const response = await plexFetch(requestPath, options)
  if (!response.ok) throw new PlexApiError(response.status, requestPath)
  return response.json() as Promise<T>
}

export async function plexText(
  requestPath: string,
  options: PlexRequestOptions = {},
): Promise<string> {
  const response = await plexFetch(requestPath, { accept: 'xml', ...options })
  if (!response.ok) throw new PlexApiError(response.status, requestPath)
  return response.text()
}
