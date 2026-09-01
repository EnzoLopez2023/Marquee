import 'dotenv/config'
import { openDatabase } from '../lib/db/connection.js'
import { createApp } from './app.js'
import { config, validateConfig } from './config.js'

validateConfig()
const database = openDatabase()
const app = createApp(database)
const server = app.listen(config.port, config.host, () => {
  console.log(`Marquee running on http://${config.host}:${config.port}`)
})

let stopping = false
const stop = (signal: string) => {
  if (stopping) return
  stopping = true
  const timeout = setTimeout(() => process.exit(1), 30_000)
  timeout.unref()
  server.close((error) => {
    let databaseCloseFailed = false
    try {
      database.close()
    } catch (closeError) {
      databaseCloseFailed = true
      console.error('Marquee database shutdown failed:', closeError)
    }
    clearTimeout(timeout)
    process.exitCode = error || databaseCloseFailed ? 1 : 0
  })
  console.log(`Marquee draining after ${signal}`)
}
database.onInstanceLeaseLost(() => stop('INSTANCE_LEASE_LOST'))
process.once('SIGTERM', () => stop('SIGTERM'))
process.once('SIGINT', () => stop('SIGINT'))
