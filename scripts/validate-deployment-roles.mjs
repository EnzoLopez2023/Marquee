import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROLES = Object.freeze({
  reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
  acrPush: '8311e382-0749-4cb8-b61a-304f252e45ec',
  acrDelete: 'c2f4ef07-c644-48eb-af81-4b1b4947fb11',
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d',
  websiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772',
})

const ROLE_NAMES = new Map([
  [ROLES.reader, 'Reader'],
  [ROLES.acrPush, 'AcrPush'],
  [ROLES.acrDelete, 'AcrDelete'],
  [ROLES.acrPull, 'AcrPull'],
  [ROLES.websiteContributor, 'Website Contributor'],
  ['43d0d8ad-25c7-4714-9337-8ba259a9fe05', 'Monitoring Reader'],
  ['b24988ac-6180-42a0-ab88-20f7382dd24c', 'Contributor'],
])

function normalizeResourceId(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase()
}

function roleId(value) {
  return normalizeResourceId(value).split('/').at(-1) || ''
}

function readAssignments(filePath) {
  const value = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!Array.isArray(value)) throw new Error(`${filePath} must contain a JSON array`)
  return value.map((entry, index) => {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof entry.roleDefinitionId !== 'string'
      || typeof entry.scope !== 'string'
      || !(
        entry.condition === null
        || entry.condition === undefined
        || typeof entry.condition === 'string'
      )
    ) {
      throw new Error(`${filePath}[${index}] is not an Azure role assignment`)
    }
    return {
      roleId: roleId(entry.roleDefinitionId),
      scope: normalizeResourceId(entry.scope),
      condition: entry.condition || '',
    }
  })
}

function validateScope(assignments, targetId, requiredRoleIds, label) {
  const target = normalizeResourceId(targetId)
  if (!target.startsWith('/subscriptions/')) {
    throw new Error(`${label} resource ID is invalid`)
  }
  const required = new Set(requiredRoleIds)
  const found = new Set()
  for (const assignment of assignments) {
    const affectsTarget = assignment.scope === target
      || target.startsWith(`${assignment.scope}/`)
    if (!affectsTarget) {
      throw new Error(`Role query returned a scope unrelated to ${label}`)
    }
    if (
      assignment.scope !== target
      || !required.has(assignment.roleId)
      || assignment.condition
    ) {
      const name = ROLE_NAMES.get(assignment.roleId) || assignment.roleId
      throw new Error(
        `Unexpected ${name} assignment at ${assignment.scope} affects ${label}`,
      )
    }
    found.add(assignment.roleId)
  }
  const missing = [...required].filter((id) => !found.has(id))
  if (missing.length) {
    const names = missing.map((id) => ROLE_NAMES.get(id) || id)
    throw new Error(`Missing ${label} roles at exact scope: ${names.join(', ')}`)
  }
}

export function validateDeploymentRoles({
  acrId,
  webappId,
  deployAcrAssignments,
  deployWebappAssignments,
  webappPullAssignments,
}) {
  validateScope(
    deployAcrAssignments,
    acrId,
    [ROLES.reader, ROLES.acrPush, ROLES.acrDelete],
    'deployment identity shared ACR',
  )
  validateScope(
    deployWebappAssignments,
    webappId,
    [ROLES.websiteContributor],
    'deployment identity Marquee Web App',
  )
  validateScope(
    webappPullAssignments,
    acrId,
    [ROLES.acrPull],
    'App Service managed identity shared ACR',
  )
}

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`Missing required argument ${name}`)
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDeploymentRoles({
    acrId: argument('--acr-id'),
    webappId: argument('--webapp-id'),
    deployAcrAssignments: readAssignments(argument('--deploy-acr-assignments')),
    deployWebappAssignments: readAssignments(argument('--deploy-webapp-assignments')),
    webappPullAssignments: readAssignments(argument('--webapp-pull-assignments')),
  })
  console.log('Deployment and pull identity role contracts verified')
}
