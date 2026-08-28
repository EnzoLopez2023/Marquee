import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { createDeliveryQueue } from '../../scripts/agentDelivery.mjs'

const artifacts: string[] = []

function queuePath() {
  const directory = join('test', 'delivery', `.agent-delivery-${process.pid}-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  artifacts.push(directory)
  return join(directory, 'queue.ndjson')
}

function rows(path: string) {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function shortWrite(maxBytes: number) {
  return ((fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => (
    writeSync(fd, buffer, offset, Math.min(length, maxBytes), position)
  )) as unknown as typeof writeSync
}

afterEach(() => {
  for (const directory of artifacts.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('durable delivery queue bounds', () => {
  it('compacts coalesced snapshots immediately and remains bounded across every reload', () => {
    const filePath = queuePath()
    const maxBytes = 600
    let queue = createDeliveryQueue({ filePath, source: 'test', maxBytes, maxEntries: 1 })

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      queue.enqueue({
        path: '/snapshot',
        body: JSON.stringify({ sequence, payload: 'x'.repeat(80) }),
        coalesceKey: 'current-state',
      })
      expect(statSync(filePath).size).toBeLessThanOrEqual(maxBytes)
      expect(rows(filePath)).toHaveLength(1)
      expect(rows(filePath)[0].body).toContain(`"sequence":${sequence}`)

      queue = createDeliveryQueue({ filePath, source: 'test', maxBytes, maxEntries: 2 })
      expect(statSync(filePath).size).toBeLessThanOrEqual(maxBytes)
      expect(queue.status().pending).toBe(1)
    }

    queue.enqueue({
      path: '/snapshot',
      body: JSON.stringify({ sequence: 5, payload: 'x'.repeat(80) }),
      coalesceKey: 'other-state',
    })
    expect(statSync(filePath).size).toBeLessThanOrEqual(maxBytes)
    expect(rows(filePath)).toHaveLength(1)
    expect(rows(filePath)[0].body).toContain('"sequence":5')
    queue = createDeliveryQueue({ filePath, source: 'test', maxBytes, maxEntries: 1 })
    expect(statSync(filePath).size).toBeLessThanOrEqual(maxBytes)
    expect(queue.status().pending).toBe(1)
  })

  it('uses actual disk bytes to compact an oversized startup queue', () => {
    const filePath = queuePath()
    const initial = createDeliveryQueue({ filePath, source: 'test', maxBytes: 10_000, maxEntries: 1 })
    initial.enqueue({ path: '/snapshot', body: JSON.stringify({ payload: 'x'.repeat(40) }), coalesceKey: 'state' })
    const normalizedBytes = statSync(filePath).size
    writeFileSync(filePath, readFileSync(filePath, 'utf8').replace(/\n/g, '\r\n'), 'utf8')
    expect(statSync(filePath).size).toBeGreaterThan(normalizedBytes)

    const reloaded = createDeliveryQueue({
      filePath,
      source: 'test',
      maxBytes: normalizedBytes,
      maxEntries: 1,
    })

    expect(statSync(filePath).size).toBeLessThanOrEqual(normalizedBytes)
    expect(reloaded.status().pending).toBe(1)
    expect(rows(filePath)).toHaveLength(1)
  })

  it('retains permanently rejected entries when dead-letter fsync fails', async () => {
    const filePath = queuePath()
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      deadLetterFs: { fsyncSync: () => { throw new Error('injected fsync failure') } },
    })
    queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' })
    const fetchStub = vi.fn(async () => new Response('invalid', { status: 400 }))
    vi.stubGlobal('fetch', fetchStub)

    await expect(queue.flush({ baseUrl: 'https://marquee.test', token: 'token', retries: 0 }))
      .rejects.toThrow('could not write dead letter')
    expect(fetchStub).toHaveBeenCalledOnce()
    expect(queue.status().pending).toBe(1)
    expect(rows(filePath)).toHaveLength(1)
  })

  it('reports capacity archival failure and retains every queued entry', () => {
    const filePath = queuePath()
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      maxEntries: 1,
      deadLetterFs: { fsyncSync: () => { throw new Error('injected fsync failure') } },
    })
    queue.enqueue({ path: '/one', body: '{"n":1}' })

    expect(() => queue.enqueue({ path: '/two', body: '{"n":2}' }))
      .toThrow('could not write dead letter')
    expect(queue.status().pending).toBe(2)
    expect(rows(filePath)).toHaveLength(2)
  })

  it('retains entries when dead-letter rotation fails', () => {
    const filePath = queuePath()
    writeFileSync(`${filePath}.dead-letter`, 'previous dead letter\n', 'utf8')
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      maxEntries: 1,
      deadLetterBytes: 1,
      deadLetterFs: { renameSync: () => { throw new Error('injected rotation failure') } },
    })
    queue.enqueue({ path: '/one', body: '{"n":1}' })

    expect(() => queue.enqueue({ path: '/two', body: '{"n":2}' }))
      .toThrow('could not write dead letter')
    expect(queue.status().pending).toBe(2)
    expect(rows(filePath)).toHaveLength(2)
  })

  it('fsyncs a queue append before making its entry eligible', () => {
    const order: string[] = []
    const queue = createDeliveryQueue({
      filePath: queuePath(),
      source: 'test',
      queueFs: {
        openSync: (_path, flags) => {
          order.push(`open:${flags}`)
          return 7
        },
        writeSync: (_fd, buffer) => {
          order.push('write')
          return typeof buffer === 'string' ? Buffer.byteLength(buffer) : buffer.byteLength
        },
        fsyncSync: () => { order.push('fsync') },
        closeSync: () => { order.push('close') },
      },
    })

    queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' })

    expect(order).toEqual(['open:a', 'write', 'fsync', 'close'])
    expect(queue.status().pending).toBe(1)
  })

  it('does not make an entry eligible when append fsync fails', () => {
    const order: string[] = []
    const queue = createDeliveryQueue({
      filePath: queuePath(),
      source: 'test',
      queueFs: {
        openSync: () => {
          order.push('open')
          return 7
        },
        writeSync: (_fd, buffer) => {
          order.push('write')
          return typeof buffer === 'string' ? Buffer.byteLength(buffer) : buffer.byteLength
        },
        fsyncSync: () => {
          order.push('fsync')
          throw new Error('injected append fsync failure')
        },
        closeSync: () => { order.push('close') },
      },
    })

    expect(() => queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' }))
      .toThrow('injected append fsync failure')
    expect(order).toEqual(['open', 'write', 'fsync', 'close'])
    expect(queue.status().pending).toBe(0)
  })

  it('quarantines torn queue rows durably before retaining valid rows', () => {
    const filePath = queuePath()
    writeFileSync(filePath, [
      '{"id":"valid","path":"/snapshot","body":"{}"}',
      '{"id":"torn"',
      '',
    ].join('\n'), 'utf8')

    const queue = createDeliveryQueue({ filePath, source: 'test' })
    const evidence = rows(`${filePath}.quarantine`)

    expect(queue.status().pending).toBe(1)
    expect(rows(filePath)).toHaveLength(1)
    expect(evidence).toEqual([
      expect.objectContaining({
        reason: expect.any(String),
        raw: '{"id":"torn"',
      }),
    ])
  })

  it('fails startup rather than discarding corrupt rows when quarantine fsync fails', () => {
    const filePath = queuePath()
    const corrupted = '{"id":"torn"'
    writeFileSync(filePath, `${corrupted}\n`, 'utf8')

    expect(() => createDeliveryQueue({
      filePath,
      source: 'test',
      quarantineFs: { fsyncSync: () => { throw new Error('injected quarantine fsync failure') } },
    })).toThrow('could not quarantine corrupt queue row')
    expect(readFileSync(filePath, 'utf8')).toBe(`${corrupted}\n`)
  })

  it('completes short queue appends before fsyncing and admitting an entry', () => {
    const filePath = queuePath()
    const writes: number[] = []
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      queueFs: {
        writeSync: ((fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => {
          writes.push(length)
          return writeSync(fd, buffer, offset, Math.min(length, 3), position)
        }) as unknown as typeof writeSync,
      },
    })

    queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' })

    expect(writes.length).toBeGreaterThan(1)
    expect(queue.status().pending).toBe(1)
    expect(rows(filePath)).toHaveLength(1)
  })

  it('completes short checkpoint writes before renaming a compacted queue', () => {
    const filePath = queuePath()
    const openPaths = new Map<number, string>()
    let tempWrites = 0
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      queueFs: {
        openSync: ((path: string, flags: string | number) => {
          const fd = openSync(path, flags)
          openPaths.set(fd, path)
          return fd
        }) as typeof openSync,
        writeSync: ((fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => {
          const isTemp = openPaths.get(fd) === `${filePath}.tmp`
          if (isTemp) tempWrites += 1
          return writeSync(fd, buffer, offset, isTemp ? Math.min(length, 3) : length, position)
        }) as unknown as typeof writeSync,
      },
    })
    queue.enqueue({ path: '/snapshot', body: '{"sequence":1}', coalesceKey: 'state' })
    queue.enqueue({ path: '/snapshot', body: '{"sequence":2}', coalesceKey: 'state' })

    expect(tempWrites).toBeGreaterThan(1)
    expect(rows(filePath)).toHaveLength(1)
    expect(rows(filePath)[0].body).toBe('{"sequence":2}')
  })

  it('completes short quarantine evidence writes before compacting startup rows', () => {
    const filePath = queuePath()
    writeFileSync(filePath, '{"id":"valid","path":"/snapshot","body":"{}"}\n{"id":"torn"\n', 'utf8')
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      quarantineFs: { writeSync: shortWrite(3) },
    })

    expect(queue.status().pending).toBe(1)
    expect(rows(`${filePath}.quarantine`)).toEqual([
      expect.objectContaining({ raw: '{"id":"torn"' }),
    ])
    expect(rows(filePath)).toHaveLength(1)
  })

  it('completes short dead-letter evidence writes before removing a rejected entry', async () => {
    const filePath = queuePath()
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      deadLetterFs: { writeSync: shortWrite(3) },
    })
    queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid', { status: 400 })))

    await expect(queue.flush({ baseUrl: 'https://marquee.test', token: 'token', retries: 0 }))
      .resolves.toMatchObject({ deadLettered: 1, pending: 0 })
    expect(rows(`${filePath}.dead-letter`)).toHaveLength(1)
    expect(rows(filePath)).toEqual([])
  })

  it('rejects a zero-progress append without admitting an entry', () => {
    const filePath = queuePath()
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      queueFs: { writeSync: () => 0 },
    })

    expect(() => queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' }))
      .toThrow('could not complete write')
    expect(queue.status().pending).toBe(0)
    expect(readFileSync(filePath, 'utf8')).toBe('')
  })

  it('does not rename an incomplete zero-progress checkpoint and retains the append backlog', () => {
    const filePath = queuePath()
    const openPaths = new Map<number, string>()
    const renames: string[] = []
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      queueFs: {
        openSync: ((path: string, flags: string | number) => {
          const fd = openSync(path, flags)
          openPaths.set(fd, path)
          return fd
        }) as typeof openSync,
        writeSync: ((fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => (
          openPaths.get(fd) === `${filePath}.tmp`
            ? 0
            : writeSync(fd, buffer, offset, length, position)
        )) as unknown as typeof writeSync,
        renameSync: ((oldPath: string, newPath: string) => {
          renames.push(`${oldPath}->${newPath}`)
        }) as typeof import('node:fs').renameSync,
      },
    })
    queue.enqueue({ path: '/snapshot', body: '{"sequence":1}', coalesceKey: 'state' })

    expect(() => queue.enqueue({ path: '/snapshot', body: '{"sequence":2}', coalesceKey: 'state' }))
      .toThrow('could not complete write')
    expect(renames).toEqual([])
    expect(rows(filePath)).toHaveLength(2)
    expect(queue.status().pending).toBe(1)
  })

  it('fails startup without overwriting corrupt rows when quarantine cannot make write progress', () => {
    const filePath = queuePath()
    const corrupted = '{"id":"torn"'
    writeFileSync(filePath, `${corrupted}\n`, 'utf8')

    expect(() => createDeliveryQueue({
      filePath,
      source: 'test',
      quarantineFs: { writeSync: () => 0 },
    })).toThrow('could not quarantine corrupt queue row')
    expect(readFileSync(filePath, 'utf8')).toBe(`${corrupted}\n`)
    expect(readFileSync(`${filePath}.quarantine`, 'utf8')).toBe('')
  })

  it('retains queue backlog and existing evidence when dead-letter writes make no progress', async () => {
    const filePath = queuePath()
    writeFileSync(`${filePath}.dead-letter`, 'previous evidence\n', 'utf8')
    const queue = createDeliveryQueue({
      filePath,
      source: 'test',
      deadLetterFs: { writeSync: () => 0 },
    })
    queue.enqueue({ path: '/snapshot', body: '{"state":"current"}' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid', { status: 400 })))

    await expect(queue.flush({ baseUrl: 'https://marquee.test', token: 'token', retries: 0 }))
      .rejects.toThrow('could not write dead letter')
    expect(queue.status().pending).toBe(1)
    expect(rows(filePath)).toHaveLength(1)
    expect(readFileSync(`${filePath}.dead-letter`, 'utf8')).toBe('previous evidence\n')
  })

  it.each(['EACCES', 'EIO'])('fails startup on %s reads without writing a queue', (code) => {
    const open = vi.fn()
    const write = vi.fn()
    const rename = vi.fn()
    const error = Object.assign(new Error(`injected ${code} read failure`), { code })

    expect(() => createDeliveryQueue({
      filePath: queuePath(),
      source: 'test',
      queueFs: {
        readFileSync: () => { throw error },
        openSync: open,
        writeSync: write,
        renameSync: rename,
      },
    })).toThrow(`could not read queue: injected ${code} read failure`)
    expect(open).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
  })
})
