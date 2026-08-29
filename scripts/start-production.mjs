import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
  throw new Error('npm start refuses a non-production NODE_ENV')
}
process.env.NODE_ENV = 'production'
process.env.MARQUEE_ROOT = root

const frontend = path.join(root, 'dist', 'index.html')
const backend = path.join(root, 'dist-server', 'server', 'bootstrap.js')
if (!existsSync(frontend)) throw new Error('Built frontend is missing; run npm run build')
if (!existsSync(backend)) throw new Error('Built server is missing; run npm run build')

const identityModule = path.join(root, 'dist-server', 'lib', 'health', 'buildIdentity.js')
const { assertProductionBuildIdentity } = await import(pathToFileURL(identityModule).href)
assertProductionBuildIdentity()
await import(pathToFileURL(backend).href)
