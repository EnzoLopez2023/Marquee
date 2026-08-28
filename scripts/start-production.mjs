import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
  throw new Error('npm start refuses a non-production NODE_ENV')
}
process.env.NODE_ENV = 'production'
process.env.MARQUEE_ROOT = root

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (
  !guid.test(process.env.AZURE_AD_TENANT_ID || '')
  || !guid.test(process.env.AZURE_AD_CLIENT_ID || '')
) {
  throw new Error('Production runtime Entra tenant/client configuration is missing or invalid')
}

const frontend = path.join(root, 'dist', 'index.html')
const backend = path.join(root, 'dist-server', 'server', 'bootstrap.js')
if (!existsSync(frontend)) throw new Error('Built frontend is missing; run npm run build')
if (!existsSync(backend)) throw new Error('Built server is missing; run npm run build')

await import(pathToFileURL(backend).href)
