// Durable outbound delivery for the on-site agents.
//
// Entries are appended before any network request and removed only after a 2xx
// response or an explicit permanent-rejection dead letter. Tokens are supplied
// at flush time and are never written to disk.
// Snapshot entries can coalesce to the newest copy; log entries can batch while
// retaining every line. The queue is deliberately dependency-free so each
// Windows agent still runs with stock Node.

import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const durableHeaders = (headers = {}) => Object.fromEntries(
  Object.entries(headers && typeof headers === 'object' ? headers : {})
    .filter(([name]) => !/(authorization|token|api[-_]?key|cookie)/i.test(name)),
)

function writeFully(fs, fd, contents) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  let offset = 0
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, null)
    if (
      typeof written !== 'number'
      || !Number.isFinite(written)
      || !Number.isInteger(written)
      || written <= 0
      || written > buffer.length - offset
    ) {
      throw new Error(`could not complete write: writeSync returned ${String(written)}`)
    }
    offset += written
  }
}

function readEntries(path, onStatus, queueFs, quarantine) {
  let contents
  try {
    contents = queueFs.readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], corruptRows: 0 }
    onStatus(`could not read queue: ${error.message}`)
    throw new Error(`could not read queue: ${error.message}`, { cause: error })
  }

  const entries = []
  const corrupt = []
  for (const line of contents.split(/\r?\n/)) {
    if (!line) continue
    try {
      const parsed = JSON.parse(line)
      if (
        !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || typeof parsed.id !== 'string'
        || typeof parsed.path !== 'string'
        || typeof parsed.body !== 'string'
      ) {
        throw new Error('queue row is not a complete delivery entry')
      }
      entries.push({ ...parsed, headers: durableHeaders(parsed.headers) })
    } catch (error) {
      corrupt.push({ line, reason: error.message })
    }
  }
  if (corrupt.length) {
    quarantine(corrupt)
    onStatus(`quarantined ${corrupt.length} corrupt queue row${corrupt.length === 1 ? '' : 's'}`)
  }
  return { entries, corruptRows: corrupt.length }
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

// Auth rotation and backend/agent rollout order are operator-fixable. Retain
// those payloads instead of draining an entire outage backlog to dead letter.
const transientStatus = (status) => (
  status === 401
  || status === 403
  || status === 404
  || status === 408
  || status === 425
  || status === 429
  || status >= 500
)

const isSnapshot = (entry) => entry.kind === 'snapshot' || Boolean(entry.coalesce_key)

function requestBody(entry) {
  return entry.body_encoding === 'base64'
    ? Buffer.from(entry.body, 'base64')
    : entry.body
}

function batchedEntry(entries) {
  const first = entries[0]
  if (!first.batch_key || !first.batch_field || entries.length === 1) return first

  const base = JSON.parse(first.body)
  const combined = []
  for (const entry of entries) {
    const parsed = JSON.parse(entry.body)
    if (Array.isArray(parsed[first.batch_field])) combined.push(...parsed[first.batch_field])
  }
  base[first.batch_field] = combined
  base.delivery_id = first.id
  return { ...first, body: JSON.stringify(base) }
}

export function createDeliveryQueue({
  filePath,
  source,
  maxBytes = 128 * 1024 * 1024,
  maxEntries = 50_000,
  deadLetterBytes = 10 * 1024 * 1024,
  onStatus = () => {},
  deadLetterFs = {},
  queueFs: queueFsOverrides = {},
  quarantineFs = {},
}) {
  const tempPath = `${filePath}.tmp`
  const deadPath = `${filePath}.dead-letter`
  const quarantinePath = `${filePath}.quarantine`
  const queueFs = {
    readFileSync: queueFsOverrides.readFileSync ?? readFileSync,
    statSync: queueFsOverrides.statSync ?? statSync,
    rmSync: queueFsOverrides.rmSync ?? rmSync,
    renameSync: queueFsOverrides.renameSync ?? renameSync,
    openSync: queueFsOverrides.openSync ?? openSync,
    writeSync: queueFsOverrides.writeSync ?? writeSync,
    fsyncSync: queueFsOverrides.fsyncSync ?? fsyncSync,
    closeSync: queueFsOverrides.closeSync ?? closeSync,
  }
  const deadFs = {
    statSync: deadLetterFs.statSync ?? statSync,
    rmSync: deadLetterFs.rmSync ?? rmSync,
    renameSync: deadLetterFs.renameSync ?? renameSync,
    openSync: deadLetterFs.openSync ?? openSync,
    writeSync: deadLetterFs.writeSync ?? writeSync,
    fsyncSync: deadLetterFs.fsyncSync ?? fsyncSync,
    closeSync: deadLetterFs.closeSync ?? closeSync,
  }
  const quarantine = {
    openSync: quarantineFs.openSync ?? queueFs.openSync,
    writeSync: quarantineFs.writeSync ?? queueFs.writeSync,
    fsyncSync: quarantineFs.fsyncSync ?? queueFs.fsyncSync,
    closeSync: quarantineFs.closeSync ?? queueFs.closeSync,
  }

  const quarantineCorruptRows = (corruptRows) => {
    try {
      const fd = quarantine.openSync(quarantinePath, 'a')
      try {
        for (const row of corruptRows) {
          writeFully(quarantine, fd, `${JSON.stringify({
            quarantined_at: Date.now(),
            reason: row.reason,
            raw: row.line,
          })}\n`)
        }
        quarantine.fsyncSync(fd)
      } finally {
        quarantine.closeSync(fd)
      }
    } catch (error) {
      onStatus(`could not quarantine corrupt queue row: ${error.message}`)
      throw new Error(`could not quarantine corrupt queue row: ${error.message}`, { cause: error })
    }
  }

  const startup = readEntries(filePath, onStatus, queueFs, quarantineCorruptRows)
  let entries = startup.entries
  let flushChain = Promise.resolve()
  let entryBytesByEntry = new Map()
  let queuedBytes = 0
  let enqueuesSincePersist = 0

  const serializedBytes = (entry) => Buffer.byteLength(JSON.stringify(entry)) + 1
  const onDiskBytes = () => {
    try {
      return queueFs.statSync(filePath).size
    } catch (error) {
      if (error.code !== 'ENOENT') onStatus(`could not stat queue: ${error.message}`)
      return 0
    }
  }
  const rebuildByteCount = () => {
    entryBytesByEntry = new Map()
    queuedBytes = 0
    for (const entry of entries) {
      const bytes = serializedBytes(entry)
      entryBytesByEntry.set(entry, bytes)
      queuedBytes += bytes
    }
  }
  const removeEntries = (index, count) => {
    const removed = entries.splice(index, count)
    for (const entry of removed) {
      queuedBytes -= entryBytesByEntry.get(entry) ?? serializedBytes(entry)
      entryBytesByEntry.delete(entry)
    }
    return removed
  }
  rebuildByteCount()

  const persist = () => {
    // Never concatenate the entire outage queue into one JavaScript string.
    // Base64-encoded gzip bodies are already large, and the temporary UTF-16
    // string plus map/join copies made a ~65 MB queue fast-fail Node on Windows
    // before the agent could drain it. Serialize one bounded entry at a time.
    const fd = queueFs.openSync(tempPath, 'w')
    try {
      for (const entry of entries) writeFully(queueFs, fd, `${JSON.stringify(entry)}\n`)
      queueFs.fsyncSync(fd)
    } finally {
      queueFs.closeSync(fd)
    }
    queueFs.renameSync(tempPath, filePath)
    enqueuesSincePersist = 0
  }

  const deadLetter = (entry, reason) => {
    try {
      try {
        if (deadFs.statSync(deadPath).size >= deadLetterBytes) {
          deadFs.rmSync(`${deadPath}.1`, { force: true })
          deadFs.renameSync(deadPath, `${deadPath}.1`)
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        // No dead-letter file yet.
      }
      const fd = deadFs.openSync(deadPath, 'a')
      try {
        writeFully(deadFs, fd, `${JSON.stringify({
          failed_at: Date.now(),
          reason,
          entry,
        })}\n`)
        deadFs.fsyncSync(fd)
      } finally {
        deadFs.closeSync(fd)
      }
    } catch (error) {
      onStatus(`could not write dead letter: ${error.message}`)
      throw new Error(`could not write dead letter: ${error.message}`, { cause: error })
    }
  }

  const enforceBounds = ({ compactSnapshots = false } = {}) => {
    let compactedCount = 0
    if (compactSnapshots) {
      const before = entries.length
      const latestByKey = new Set()
      const compacted = []
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry.coalesce_key) {
          if (latestByKey.has(entry.coalesce_key)) continue
          latestByKey.add(entry.coalesce_key)
        }
        compacted.push(entry)
      }
      entries = compacted.reverse()
      compactedCount = before - entries.length
      rebuildByteCount()
    }

    const removed = new Set()
    let retainedCount = entries.length
    let retainedBytes = queuedBytes
    const overCapacity = () => retainedCount > maxEntries || retainedBytes > maxBytes
    // Coalesced snapshots are the newest known state for each subsystem.
    // Preserve them and shed oldest historical events first in one linear pass.
    for (const snapshotPass of [false, true]) {
      for (const entry of entries) {
        if (!overCapacity()) break
        if (isSnapshot(entry) !== snapshotPass) continue
        removed.add(entry)
        retainedCount -= 1
        retainedBytes -= entryBytesByEntry.get(entry) ?? serializedBytes(entry)
      }
      if (!overCapacity()) break
    }
    const dropped = removed.size
    if (dropped) {
      for (const entry of removed) deadLetter(entry, 'queue capacity exceeded')
      entries = entries.filter((entry) => !removed.has(entry))
      rebuildByteCount()
    }
    if (dropped) onStatus(`queue capacity exceeded; moved ${dropped} oldest entr${dropped === 1 ? 'y' : 'ies'} to dead letter`)
    return { dropped, compacted: compactedCount }
  }

  const enqueue = ({
    path,
    body,
    headers = {},
    timeoutMs = 30_000,
    coalesceKey = null,
    batchKey = null,
    batchField = null,
    maxBatchItems = 500,
  }) => {
    const buffer = Buffer.isBuffer(body) ? body : null
    const persistedHeaders = durableHeaders(headers)
    const entry = {
      id: `${source}-${Date.now()}-${randomUUID()}`,
      source,
      queued_at: Date.now(),
      path,
      headers: persistedHeaders,
      timeout_ms: timeoutMs,
      kind: coalesceKey ? 'snapshot' : 'event',
      coalesce_key: coalesceKey,
      batch_key: batchKey,
      batch_field: batchField,
      max_batch_items: maxBatchItems,
      body_encoding: buffer ? 'base64' : 'utf8',
      body: buffer ? buffer.toString('base64') : String(body),
    }
    const fd = queueFs.openSync(filePath, 'a')
    try {
      writeFully(queueFs, fd, `${JSON.stringify(entry)}\n`)
      queueFs.fsyncSync(fd)
    } finally {
      queueFs.closeSync(fd)
    }
    entries.push(entry)
    const bytes = serializedBytes(entry)
    entryBytesByEntry.set(entry, bytes)
    queuedBytes += bytes
    let coalesced = false
    if (coalesceKey) {
      for (let index = entries.length - 2; index >= 0; index -= 1) {
        if (entries[index].coalesce_key === coalesceKey) {
          removeEntries(index, 1)
          coalesced = true
        }
      }
    }
    const { dropped } = enforceBounds()
    enqueuesSincePersist += 1
    // Appends are already durable. Compact stale snapshots periodically rather
    // than rewriting a potentially large outage queue on every log line. A
    // replacement or capacity eviction must compact immediately: the append
    // above otherwise leaves discarded rows on disk until the next checkpoint.
    if (coalesced || dropped || onDiskBytes() > maxBytes || enqueuesSincePersist >= 100) persist()
    if (!entryBytesByEntry.has(entry)) {
      throw new Error('delivery queue capacity rejected the new entry')
    }
    return entry.id
  }

  const send = async (entry, { baseUrl, token, retries }) => {
    let lastFailure = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}${entry.path}`, {
          method: 'POST',
          headers: {
            ...entry.headers,
            authorization: `Bearer ${token}`,
            'X-Marquee-Delivery-Id': entry.id,
            'X-Hearth-Delivery-Id': entry.id,
          },
          body: requestBody(entry),
          signal: AbortSignal.timeout(entry.timeout_ms),
        })
        const detail = await response.text().catch(() => '')
        if (response.ok) {
          let duplicate = false
          try { duplicate = JSON.parse(detail)?.duplicate === true } catch { /* optional JSON body */ }
          return { accepted: true, duplicate, status: response.status }
        }
        if (!transientStatus(response.status)) {
          return {
            accepted: false,
            permanent: true,
            status: response.status,
            detail: detail.slice(0, 300),
          }
        }
        lastFailure = `HTTP ${response.status}: ${detail.slice(0, 200)}`
        if (attempt < retries) {
          const wait = Math.min(
            retryAfterMs(response) ?? 1000 * (2 ** attempt),
            30_000,
          )
          await sleep(wait)
        }
      } catch (error) {
        lastFailure = error.message
        if (attempt < retries) await sleep(Math.min(1000 * (2 ** attempt), 30_000))
      }
    }
    return { accepted: false, permanent: false, detail: lastFailure || 'delivery failed' }
  }

  const flushOnce = async ({
    baseUrl,
    token,
    maxRequests = 50,
    retries = 1,
  }) => {
    if (!baseUrl || !token) throw new Error('baseUrl and token are required to flush the delivery queue')
    const bounded = enforceBounds()
    let changed = bounded.dropped > 0

    let accepted = 0
    const acceptedIds = []
    let deadLettered = 0
    const deadLetteredIds = []
    let requests = 0
    while (entries.length && requests < maxRequests) {
      // Deliver the newest subsystem snapshots before historical events so an
      // outage recovery is reflected in Hearth immediately, without discarding
      // or reordering the event backlog itself.
      const snapshotIndex = entries.findIndex(isSnapshot)
      const startIndex = snapshotIndex >= 0 ? snapshotIndex : 0
      const first = entries[startIndex]
      const group = [first]
      if (first.batch_key && first.batch_field) {
        for (
          let index = startIndex + 1;
          index < entries.length && group.length < first.max_batch_items;
          index += 1
        ) {
          const candidate = entries[index]
          if (
            candidate.batch_key !== first.batch_key
            || candidate.batch_field !== first.batch_field
            || candidate.path !== first.path
          ) break
          group.push(candidate)
        }
      }

      let outgoing
      try {
        outgoing = batchedEntry(group)
      } catch (error) {
        for (const entry of group) deadLetter(entry, `could not build batch: ${error.message}`)
        removeEntries(startIndex, group.length)
        changed = true
        deadLettered += group.length
        deadLetteredIds.push(...group.map((entry) => entry.id))
        continue
      }

      requests += 1
      const result = await send(outgoing, { baseUrl, token, retries })
      if (result.accepted) {
        // A prior attempt may have reached Hearth even though its response was
        // lost. If that first delivery ID is now retried with newer log entries
        // batched behind it, Hearth correctly reports the ID as a duplicate but
        // has not seen the newer rows. Drop only the known duplicate and send the
        // remainder under its own first ID on the next request.
        const consumed = result.duplicate && group.length > 1 ? group.slice(0, 1) : group
        removeEntries(startIndex, consumed.length)
        changed = true
        accepted += consumed.length
        acceptedIds.push(...consumed.map((entry) => entry.id))
        continue
      }
      if (result.permanent) {
        for (const entry of group) {
          deadLetter(entry, `permanent HTTP ${result.status}: ${result.detail || ''}`)
        }
        removeEntries(startIndex, group.length)
        changed = true
        deadLettered += group.length
        deadLetteredIds.push(...group.map((entry) => entry.id))
        onStatus(`delivery rejected permanently with HTTP ${result.status}; moved ${group.length} entr${group.length === 1 ? 'y' : 'ies'} to dead letter`)
        continue
      }

      onStatus(`delivery deferred after retries: ${result.detail}`)
      break
    }

    // Idempotency receipts make it safe to checkpoint once after the drain. If
    // the process stops mid-flush, replayed accepted entries are acknowledged as
    // duplicates instead of being written twice.
    if (changed) persist()
    return {
      accepted,
      acceptedIds,
      deadLettered,
      deadLetteredIds,
      pending: entries.length,
      oldestQueuedAt: entries[0]?.queued_at ?? null,
      requests,
    }
  }

  const flush = (options) => {
    const run = flushChain.then(
      () => flushOnce(options),
      () => flushOnce(options),
    )
    flushChain = run.catch(() => {})
    return run
  }

  const status = () => ({
    pending: entries.length,
    queuedBytes,
    oldestQueuedAt: entries[0]?.queued_at ?? null,
  })

  const startupBounds = enforceBounds({ compactSnapshots: true })
  if (startup.corruptRows || startupBounds.dropped || startupBounds.compacted || onDiskBytes() > maxBytes) persist()
  return { enqueue, flush, status }
}
