import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '../../src/services/apiError.js'

describe('typed API error rendering', () => {
  it('always returns a safe display string', () => {
    expect(apiErrorMessage({ error: 'Denied' }, 'Fallback')).toBe('Denied')
    expect(apiErrorMessage({ error: { message: 'Sign in required' } }, 'Fallback'))
      .toBe('Sign in required')
    expect(apiErrorMessage({ error: { code: 'ROLE_REQUIRED' } }, 'Fallback'))
      .toBe('ROLE REQUIRED')
    expect(apiErrorMessage({ error: { nested: true } }, 'Fallback')).toBe('Fallback')
  })
})
