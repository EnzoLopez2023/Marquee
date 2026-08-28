import { describe, expect, it, vi } from 'vitest'
import { createAuthorization } from '../../server/auth/authorize.js'

const repositories = {
  identities: {
    touch: vi.fn(),
    roles: vi.fn(),
    features: vi.fn(),
  },
} as any

describe('feature-scoped mutation authorization', () => {
  it('does not widen a global editor role into feature edit permission', () => {
    const authorization = createAuthorization(repositories)
    const req = {
      roles: ['viewer'],
      featurePermissions: {
        'plex-library': { canEdit: false, isHidden: false },
      },
    } as any
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()
    authorization.requireFeatureEdit('plex-library')(
      req,
      { status, json } as any,
      next,
    )
    expect(status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('allows only the matching feature grant or admin', () => {
    const authorization = createAuthorization(repositories)
    const next = vi.fn()
    authorization.requireFeatureEdit('plex-library')({
      roles: ['viewer'],
      featurePermissions: {
        'plex-library': { canEdit: true, isHidden: false },
      },
    } as any, {} as any, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('denies hidden reads and permits a shared read only when one owner is visible', () => {
    const authorization = createAuthorization(repositories)
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()
    const hidden = {
      roles: ['viewer'],
      featurePermissions: {
        'plex-library': { canEdit: false, isHidden: true },
        'plex-command-center': { canEdit: false, isHidden: true },
      },
    } as any
    authorization.requireFeature('plex-library')(hidden, { status, json } as any, next)
    expect(status).toHaveBeenCalledWith(403)
    authorization.requireAnyFeature(['plex-library', 'plex-command-center'])(
      hidden,
      { status, json } as any,
      next,
    )
    expect(next).not.toHaveBeenCalled()

    hidden.featurePermissions['plex-command-center'].isHidden = false
    authorization.requireAnyFeature(['plex-library', 'plex-command-center'])(
      hidden,
      { status, json } as any,
      next,
    )
    expect(next).toHaveBeenCalledOnce()
  })
})
