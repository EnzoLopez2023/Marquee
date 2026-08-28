import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/index.js'
import type { AppRole, Identity } from '../../lib/db/repositories/identities.js'
import { assertDelegatedUserClaims, verifyAccessToken } from './entra.js'
import { config, resolveAdminOid } from '../config.js'

const bearer = (req: Request) => {
  const header = req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

export function createAuthorization(repositories: Repositories) {
  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: { code: 'SIGN_IN_REQUIRED' } })
    try {
      const claims = assertDelegatedUserClaims(await verifyAccessToken(token))
      const identity: Identity = {
        tenantId: claims.tid,
        oid: claims.oid,
        email: typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : typeof claims.email === 'string' ? claims.email : null,
        name: typeof claims.name === 'string' ? claims.name : null,
      }
      await repositories.identities.touch(identity)
      const roles = await repositories.identities.roles(identity)
      const featurePermissions = await repositories.identities.features(identity)
      const configuredAdmin = resolveAdminOid(
        config.entra.adminOid,
        config.entra.bootstrapAdminOid,
        false,
      )
      if (identity.oid === configuredAdmin && !roles.includes('admin')) roles.push('admin')
      req.identity = identity
      req.roles = roles.length ? roles : ['viewer']
      req.featurePermissions = featurePermissions
      return next()
    } catch (error) {
      console.warn('Entra access token rejected:', error instanceof Error ? error.message : String(error))
      return res.status(401).json({ error: { code: 'INVALID_ACCESS_TOKEN' } })
    }
  }

  const requireRole = (role: AppRole) => (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const roles = req.roles ?? []
    if (roles.includes('admin') || roles.includes(role)) return next()
    return res.status(403).json({ error: { code: 'ROLE_REQUIRED', role } })
  }

  const requireFeature = (feature: string) => (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (req.roles?.includes('admin')) return next()
    if (req.featurePermissions?.[feature]?.isHidden) {
      return res.status(403).json({ error: { code: 'FEATURE_HIDDEN', feature } })
    }

    return next()
  }

  const requireAnyFeature = (features: string[]) => (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (req.roles?.includes('admin')) return next()
    if (features.some((feature) => !req.featurePermissions?.[feature]?.isHidden)) {
      return next()
    }
    return res.status(403).json({ error: { code: 'FEATURE_HIDDEN', features } })
  }

  const requireFeatureEdit = (feature: string) => (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (req.roles?.includes('admin')) return next()
    const permission = req.featurePermissions?.[feature]
    if (permission?.isHidden || !permission?.canEdit) {
      return res.status(403).json({ error: { code: 'FEATURE_EDIT_REQUIRED', feature } })
    }
    return next()
  }

  return { requireUser, requireRole, requireFeature, requireAnyFeature, requireFeatureEdit }
}
