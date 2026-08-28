import { gunzipSync, gzipSync } from 'node:zlib'

export const packJson = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value), 'utf8'))

export function unpackJson(stored: unknown): any {
  if (stored == null) return null
  try {
    if (Buffer.isBuffer(stored)) return JSON.parse(gunzipSync(stored).toString('utf8'))
    return JSON.parse(String(stored))
  } catch {
    return null
  }
}
