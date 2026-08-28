export interface DeliveryQueue {
  enqueue(options: {
    path: string
    body: string | Buffer
    headers?: Record<string, string>
    timeoutMs?: number
    coalesceKey?: string | null
    batchKey?: string | null
    batchField?: string | null
    maxBatchItems?: number
  }): string
  flush(options: {
    baseUrl: string
    token: string
    maxRequests?: number
    retries?: number
  }): Promise<{
    accepted: number
    acceptedIds: string[]
    deadLettered: number
    deadLetteredIds: string[]
    pending: number
    oldestQueuedAt: number | null
    requests: number
  }>
  status(): {
    pending: number
    queuedBytes: number
    oldestQueuedAt: number | null
  }
}

export function createDeliveryQueue(options: {
  filePath: string
  source: string
  maxBytes?: number
  maxEntries?: number
  deadLetterBytes?: number
  onStatus?: (message: string) => void
  deadLetterFs?: Partial<Pick<typeof import('node:fs'),
    'statSync' | 'rmSync' | 'renameSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
  >>
  queueFs?: Partial<Pick<typeof import('node:fs'),
    'readFileSync' | 'statSync' | 'rmSync' | 'renameSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
  >>
  quarantineFs?: Partial<Pick<typeof import('node:fs'),
    'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync'
  >>
}): DeliveryQueue
