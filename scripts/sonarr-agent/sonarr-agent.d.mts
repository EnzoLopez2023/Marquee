export interface AgentConfig {
  marqueeUrl?: string
  ingestToken?: string
  sonarrUrl: string
  sonarrApiKey: string
  requestTimeoutSeconds: number
  fullPollMinutes: number
  pollMinutes: number
  [key: string]: unknown
}

export interface EndpointDiagnostic {
  key: string
  path: string
  ok: boolean
  stale: boolean
  count: number
  collected_at: number
  last_success_at: number | null
  duration_ms: number
  error?: string
}

export interface CollectionResult {
  data: Record<string, any>
  diagnostics: EndpointDiagnostic[]
}

export interface CollectionState {
  cachedFastData: Record<string, any>
  cachedFastDiagnostics: EndpointDiagnostic[]
  cachedFullData: Record<string, any> | null
  cachedFullDiagnostics: EndpointDiagnostic[]
  lastFullAt: number
  lastFullAttemptAt: number | null
}

export function loadConfig(configPath?: string): AgentConfig
export function normalizeMarqueeUrl(raw: string): string
export function redactAbsoluteFilesystemString(value: string): string
export function sanitizeAgentLogMessage(value: unknown): string
export function sanitizeSnapshotForDelivery(value: unknown): unknown
export function createCollectionState(): CollectionState
export function collectFast(
  config: AgentConfig,
  previousData?: Record<string, any>,
  previousDiagnostics?: EndpointDiagnostic[],
): Promise<CollectionResult>
export function collectFull(
  config: AgentConfig,
  previousData?: Record<string, any>,
  previousDiagnostics?: EndpointDiagnostic[],
): Promise<CollectionResult>
export function collectSnapshot(
  config: AgentConfig,
  state: CollectionState,
  options?: {
    now?: () => number
    fastCollector?: (
      config: AgentConfig,
      previousData: Record<string, any>,
      previousDiagnostics: EndpointDiagnostic[],
    ) => Promise<CollectionResult>
    fullCollector?: (
      config: AgentConfig,
      previousData: Record<string, any>,
      previousDiagnostics: EndpointDiagnostic[],
    ) => Promise<CollectionResult>
  },
): Promise<{
  snapshot: any
  fullDue: boolean
  fullComplete: boolean
}>
export function drainOnly(
  config: Pick<AgentConfig, 'marqueeUrl' | 'ingestToken'>,
  options?: { queue?: {
    status(): { pending: number }
    flush(options: {
      baseUrl: string
      token: string
      maxRequests?: number
    }): Promise<{ accepted: number, deadLettered: number, pending: number }>
  } },
): Promise<{ accepted: number, deadLettered: number, pending: number }>
export function pushSnapshot(
  config: Pick<AgentConfig, 'marqueeUrl' | 'ingestToken'>,
  snapshot: unknown,
  options?: {
    queue?: {
      enqueue(options: {
        path: string
        body: string | Buffer
        headers?: Record<string, string>
        timeoutMs?: number
        coalesceKey?: string | null
      }): string
      flush(options: {
        baseUrl: string
        token: string
        maxRequests?: number
      }): Promise<{ acceptedIds: string[], deadLetteredIds: string[], pending: number }>
    }
  },
): Promise<{ compressedBytes: number, wireBytes: number, accepted: boolean, pending: number }>
