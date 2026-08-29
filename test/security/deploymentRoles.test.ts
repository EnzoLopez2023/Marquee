import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const subscription = '/subscriptions/11111111-1111-4111-8111-111111111111'
const resourceGroup = `${subscription}/resourceGroups/rg-personal-apps-prod`
const acrId = `${resourceGroup}/providers/Microsoft.ContainerRegistry/registries/acrenzolopez01`
const webappId = `${resourceGroup}/providers/Microsoft.Web/sites/app-marquee-prod`
const deployObjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const webappPullObjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const roleIds = {
  Reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
  AcrPush: '8311e382-0749-4cb8-b61a-304f252e45ec',
  AcrDelete: 'c2f4ef07-c644-48eb-af81-4b1b4947fb11',
  AcrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d',
  'Website Contributor': 'de139f84-1756-47ae-9be6-808fbbe84772',
  'Monitoring Reader': '43d0d8ad-25c7-4714-9337-8ba259a9fe05',
  Contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
} as const
type RoleName = keyof typeof roleIds
const directories: string[] = []

interface Assignment {
  roleDefinitionId: string
  scope: string
  condition: string | null
  principalId: string
}

function assignment(
  role: RoleName,
  scope: string,
  principalId = role === 'AcrPull' ? webappPullObjectId : deployObjectId,
): Assignment {
  return {
    roleDefinitionId: `${subscription}/providers/Microsoft.Authorization/roleDefinitions/${roleIds[role]}`,
    scope,
    condition: null,
    principalId,
  }
}

function validate(options: {
  deployAcr?: Assignment[]
  deployWebapp?: Assignment[]
  webappPull?: Assignment[]
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'marquee-deployment-roles-'))
  directories.push(directory)
  const files = {
    deployAcr: path.join(directory, 'deploy-acr.json'),
    deployWebapp: path.join(directory, 'deploy-webapp.json'),
    webappPull: path.join(directory, 'webapp-pull.json'),
  }
  writeFileSync(files.deployAcr, JSON.stringify(options.deployAcr ?? [
    assignment('Reader', acrId),
    assignment('AcrPush', acrId),
    assignment('AcrDelete', acrId),
  ]))
  writeFileSync(files.deployWebapp, JSON.stringify(options.deployWebapp ?? [
    assignment('Website Contributor', webappId),
  ]))
  writeFileSync(files.webappPull, JSON.stringify(options.webappPull ?? [
    assignment('AcrPull', acrId),
  ]))
  return spawnSync(process.execPath, [
    'scripts/validate-deployment-roles.mjs',
    '--acr-id', acrId,
    '--webapp-id', webappId,
    '--deploy-object-id', deployObjectId,
    '--webapp-pull-object-id', webappPullObjectId,
    '--deploy-acr-assignments', files.deployAcr,
    '--deploy-webapp-assignments', files.deployWebapp,
    '--webapp-pull-assignments', files.webappPull,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('deployment identity role contract', () => {
  it('derives the OIDC object ID without Microsoft Graph and checks both identities', () => {
    const script = readFileSync(
      'scripts/verify-deployment-role-contract.sh',
      'utf8',
    )
    expect(script).toContain('claims.oid')
    expect(script).toContain('--assignee-object-id "$1"')
    expect(script).toContain('--include-groups')
    expect(script).toContain('--fill-principal-name false')
    expect(script).toContain('az webapp identity show')
    expect(script).not.toContain('--all')
  })

  it('accepts only the canonical exact-scope assignments', () => {
    const result = validate()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('role contracts verified')
  })

  it('requires Reader, AcrPush, and AcrDelete on the exact shared ACR', () => {
    const result = validate({
      deployAcr: [
        assignment('Reader', acrId),
        assignment('AcrPush', acrId),
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing deployment identity shared ACR roles')
    expect(result.stderr).toContain('AcrDelete')
  })

  it.each([
    ['Reader', resourceGroup],
    ['Monitoring Reader', resourceGroup],
    ['Contributor', acrId],
  ] satisfies Array<[RoleName, string]>)(
    'rejects %s beyond the locked deployment contract',
    (role, scope) => {
      const result = validate({
        deployAcr: [
          assignment('Reader', acrId),
          assignment('AcrPush', acrId),
          assignment('AcrDelete', acrId),
          assignment(role, scope),
        ],
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Unexpected ${role} assignment`)
    },
  )

  it('requires Website Contributor on the exact Web App', () => {
    const result = validate({
      deployWebapp: [assignment('Website Contributor', resourceGroup)],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('deployment identity Marquee Web App')
  })

  it('rejects conditional assignments that do not match the locked role', () => {
    const restrictedPush = {
      ...assignment('AcrPush', acrId),
      condition: '@Resource[repository] StringEqualsIgnoreCase "other"',
    }
    const result = validate({
      deployAcr: [
        assignment('Reader', acrId),
        restrictedPush,
        assignment('AcrDelete', acrId),
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unexpected AcrPush assignment')
  })

  it('requires the App Service managed identity AcrPull at exact ACR scope', () => {
    const result = validate({
      webappPull: [assignment('AcrPull', resourceGroup)],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('App Service managed identity shared ACR')
  })

  it('rejects group-derived assignments while requiring direct assignments', () => {
    const result = validate({
      deployAcr: [
        assignment('Reader', acrId),
        assignment('AcrPush', acrId),
        assignment('AcrDelete', acrId),
        assignment(
          'Contributor',
          resourceGroup,
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unexpected group-derived Contributor assignment')
  })
})
