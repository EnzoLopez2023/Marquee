import type { Identity, AppRole } from '../../lib/db/repositories/identities.js'

declare global {
  namespace Express {
    interface Request {
      identity?: Identity
      roles?: AppRole[]
      featurePermissions?: Record<string, { canEdit: boolean; isHidden: boolean }>
      serviceConsumer?: 'watchtower' | 'prism' | 'sonarr'
    }
  }
}

export {}
