import { mkdirSync, realpathSync, rmdirSync } from 'node:fs'
import path from 'node:path'

export interface AuthorityTransitionLock {
  path: string
  release(): void
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

export function acquireAuthorityTransitionLock(databasePath: string): AuthorityTransitionLock {
  const lockPath = authorityTransitionLockPath(databasePath)
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Marquee database authority transition is already in progress')
    }
    throw error
  }
  let released = false
  return {
    path: lockPath,
    release() {
      if (released) return
      released = true
      rmdirSync(lockPath)
    },
  }
}

export const instanceLifetimeLockPath = (databasePath: string) => (
  `${canonicalLockBase(databasePath)}.active-instance.lock`
)

export function acquireInstanceLifetimeLock(databasePath: string): AuthorityTransitionLock {
  const lockPath = instanceLifetimeLockPath(databasePath)
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'Marquee database has an active or stale lifetime instance lock; fence the prior process before continuing',
      )
    }
    throw error
  }
  let released = false
  return {
    path: lockPath,
    release() {
      if (released) return
      released = true
      rmdirSync(lockPath)
    },
  }
}
