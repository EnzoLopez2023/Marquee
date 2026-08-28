import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Express } from 'express'
import { openDatabase } from '../lib/db/connection.js'

export function temporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'marquee-test-'))
  const handle = openDatabase(path.join(directory, 'marquee.db'))
  return {
    ...handle,
    cleanup() {
      handle.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP')
  try {
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
