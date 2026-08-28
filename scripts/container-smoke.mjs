import assert from 'node:assert/strict'

const baseUrl = `http://127.0.0.1:${process.env.PORT || '3001'}`

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

const [versionFile, versionApi, live, ready, runtime] = await Promise.all([
  json('/version.json'),
  json('/api/version'),
  json('/api/live'),
  json('/api/ready'),
  json('/api/config'),
])

assert.deepEqual(versionFile, versionApi)
for (const payload of [versionFile, live, ready]) {
  assert.equal(payload.app, 'marquee')
  assert.equal(payload.commit, process.env.MARQUEE_BUILD_COMMIT)
  assert.equal(payload.buildId, process.env.MARQUEE_BUILD_ID)
  assert.equal(payload.environment, 'production')
}
assert.equal(live.status, 'live')
assert.equal(ready.status, 'ready')
assert.equal(ready.database.journalMode, 'delete')
assert.equal(runtime.entraTenantId, process.env.AZURE_AD_TENANT_ID)
assert.equal(runtime.entraClientId, process.env.AZURE_AD_CLIENT_ID)
assert.equal(
  runtime.entraApiScope,
  `api://${process.env.AZURE_AD_CLIENT_ID}/Marquee.User`,
)
assert.deepEqual(
  Object.keys(runtime).sort(),
  ['entraApiScope', 'entraClientId', 'entraTenantId'],
)

console.log(JSON.stringify({ version: versionFile, live, ready, runtime }))
