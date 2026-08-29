import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const metadata = {
  version: process.env.MARQUEE_BUILD_VERSION || '',
  commit: process.env.MARQUEE_BUILD_COMMIT || '',
  buildId: process.env.MARQUEE_BUILD_ID || '',
  buildTime: process.env.MARQUEE_BUILD_TIME || '',
}

writeFileSync(
  path.resolve('build-metadata.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o444 },
)
