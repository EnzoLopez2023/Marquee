import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('production start contract', () => {
  it('routes npm start through the fail-closed production wrapper', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.start).toBe('node scripts/start-production.mjs')
    const result = spawnSync(
      process.execPath,
      ['scripts/start-production.mjs'],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'development' },
        encoding: 'utf8',
      },
    )
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'npm start refuses a non-production NODE_ENV',
    )
  })

  it('uses one exact delegated user scope on both sides', () => {
    const frontend = readFileSync('src/auth/msalConfig.ts', 'utf8')
    const runtime = readFileSync('src/auth/runtimeConfig.ts', 'utf8')
    const backend = readFileSync('server/config.ts', 'utf8')
    expect(runtime).toContain('/Marquee.User')
    expect(frontend).not.toContain('access_as_user')
    expect(backend).toContain("userScope: 'Marquee.User'")
  })

  it('rejects a production start without runtime Entra values', () => {
    const env = { ...process.env }
    delete env.NODE_ENV
    delete env.AZURE_AD_TENANT_ID
    delete env.AZURE_AD_CLIENT_ID
    const result = spawnSync(process.execPath, ['scripts/start-production.mjs'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Production runtime Entra tenant/client configuration is missing or invalid',
    )
  })

  it.each(['WATCHTOWER_CLIENT_ID', 'PRISM_CLIENT_ID'])(
    'rejects a malformed optional %s before loading the application',
    (name) => {
      const env = {
        ...process.env,
        AZURE_AD_TENANT_ID: '52188f12-db6b-46c6-88ff-08c802f0ed3b',
        AZURE_AD_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
        [name]: 'malformed',
      }
      delete env.NODE_ENV
      const result = spawnSync(process.execPath, ['scripts/start-production.mjs'], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      })
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`).toContain(
        `${name} must be a GUID when configured`,
      )
    },
  )

  it('keeps rollback armed after any attempted production mutation', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(workflow).toContain(
      "(failure() || cancelled()) && steps.current.outcome == 'success' && steps.deploy.outcome != 'skipped'",
    )
    expect(workflow).toContain(
      'docker buildx imagetools create --tag "$IMAGE:production" "$IMAGE@$DIGEST"',
    )
    expect(workflow).toContain('--connect-timeout 2 --max-time 5')
  })
})
