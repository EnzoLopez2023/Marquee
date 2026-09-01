import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

export interface AuthorityTransitionLock {
  path: string
  release(): void
}

export interface InstanceLifetimeLock extends AuthorityTransitionLock {
  commitReclamation(): void
}

interface AuthorityTransitionLockOptions {
  ownerId?: string
  reclaimAfterMs?: number
  legacyReclaimAfterMs?: number
  canReclaim?: () => boolean
}

export function canonicalAuthorityPath(databasePath: string) {
  const resolved = path.resolve(databasePath)
  try {
    return realpathSync(resolved)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved
    throw error
  }
}

const canonicalLockBase = (databasePath: string) => {
  const resolved = path.resolve(databasePath)
  try {
    return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved
    throw error
  }
}

export const authorityTransitionLockPath = (databasePath: string) => (
  `${canonicalLockBase(databasePath)}.authority-transition.lock`
)

const ownerMarkerPath = (lockPath: string, ownerId: string) => (
  path.join(lockPath, `.owner-${ownerId}`)
)

const createOwnedDirectoryLock = (
  lockPath: string,
  ownerId: string,
  contents = '',
) => {
  const markerPath = ownerMarkerPath(lockPath, ownerId)
  mkdirSync(lockPath, { mode: 0o700 })
  try {
    writeFileSync(markerPath, contents, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    rmdirSync(lockPath)
    throw error
  }
  return markerPath
}

const releaseOwnedDirectoryLock = (lockPath: string, markerPath: string) => {
  try {
    unlinkSync(markerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  rmdirSync(lockPath)
}

const transitionLockError = () => new Error(
  'Marquee database authority transition is already in progress',
)

const transitionLockIsReclaimable = (
  lockPath: string,
  canReclaim: (() => boolean) | undefined,
  legacyReclaimAfterMs: number | undefined,
) => {
  if (!canReclaim) return false
  const marker = readdirSync(lockPath).find((entry) => entry.startsWith('.owner-'))
  const legacyLockExpired = () => (
    typeof legacyReclaimAfterMs === 'number'
    && Number.isFinite(legacyReclaimAfterMs)
    && statSync(lockPath).mtimeMs + legacyReclaimAfterMs < Date.now()
  )
  if (!marker) return legacyLockExpired() && canReclaim()
  let metadata: unknown
  try {
    metadata = JSON.parse(readFileSync(path.join(lockPath, marker), 'utf8'))
  } catch {
    return legacyLockExpired() && canReclaim()
  }
  if (!metadata || typeof metadata !== 'object') return false
  const reclaimAfter = (metadata as { reclaimAfter?: unknown }).reclaimAfter
  return typeof reclaimAfter === 'number'
    && Number.isFinite(reclaimAfter)
    && reclaimAfter < Date.now()
    && canReclaim()
}

const sweepDisplacedTransitionLocks = (lockPath: string) => {
  const parent = path.dirname(lockPath)
  const prefix = `${path.basename(lockPath)}.stale-`
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith(prefix)) {
      rmSync(path.join(parent, entry), { recursive: true, force: true })
    }
  }
}

export function acquireAuthorityTransitionLock(
  databasePath: string,
  options: AuthorityTransitionLockOptions = {},
): AuthorityTransitionLock {
  const lockPath = authorityTransitionLockPath(databasePath)
  const ownerId = options.ownerId ?? randomUUID()
  const metadata = JSON.stringify({
    reclaimAfter: options.reclaimAfterMs === undefined
      ? null
      : Date.now() + options.reclaimAfterMs,
  })
  let markerPath: string
  try {
    markerPath = createOwnedDirectoryLock(lockPath, ownerId, metadata)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!transitionLockIsReclaimable(
      lockPath,
      options.canReclaim,
      options.legacyReclaimAfterMs,
    )) {
      throw transitionLockError()
    }
    const displacedPath = `${lockPath}.stale-${ownerId}`
    try {
      renameSync(lockPath, displacedPath)
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError
    }
    try {
      markerPath = createOwnedDirectoryLock(lockPath, ownerId, metadata)
    } catch (acquireError) {
      rmSync(displacedPath, { recursive: true, force: true })
      if ((acquireError as NodeJS.ErrnoException).code === 'EEXIST') {
        throw transitionLockError()
      }
      throw acquireError
    }
  }
  sweepDisplacedTransitionLocks(lockPath)
  let released = false
  return {
    path: lockPath,
    release() {
      if (released) return
      released = true
      releaseOwnedDirectoryLock(lockPath, markerPath)
    },
  }
}

export const instanceLifetimeLockPath = (databasePath: string) => (
  `${canonicalLockBase(databasePath)}.active-instance.lock`
)

const lifetimeLockError = () => new Error(
  'Marquee database has an active lifetime instance lock; fence the prior process before continuing',
)

export function acquireInstanceLifetimeLock(
  databasePath: string,
  ownerId: string,
  canReclaim: () => boolean,
): InstanceLifetimeLock {
  const lockPath = instanceLifetimeLockPath(databasePath)
  const displacedPath = `${lockPath}.stale`
  let markerPath: string
  let displaced = false
  try {
    markerPath = createOwnedDirectoryLock(lockPath, ownerId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!canReclaim()) throw lifetimeLockError()
    rmSync(displacedPath, { recursive: true, force: true })
    try {
      renameSync(lockPath, displacedPath)
      displaced = true
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError
    }
    try {
      markerPath = createOwnedDirectoryLock(lockPath, ownerId)
    } catch (acquireError) {
      if (displaced) renameSync(displacedPath, lockPath)
      if ((acquireError as NodeJS.ErrnoException).code === 'EEXIST') {
        throw lifetimeLockError()
      }
      throw acquireError
    }
  }
  let released = false
  let reclamationCommitted = false
  return {
    path: lockPath,
    commitReclamation() {
      if (reclamationCommitted) return
      rmSync(displacedPath, { recursive: true, force: true })
      displaced = false
      reclamationCommitted = true
    },
    release() {
      if (released) return
      released = true
      let releaseError: unknown = null
      try {
        releaseOwnedDirectoryLock(lockPath, markerPath)
      } catch (error) {
        releaseError = error
      }
      if (displaced && !reclamationCommitted) {
        try {
          renameSync(displacedPath, lockPath)
          displaced = false
        } catch (error) {
          releaseError ??= error
        }
      }
      if (releaseError) throw releaseError
    },
  }
}
