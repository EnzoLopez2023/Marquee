import { describe, expect, it } from 'vitest'
import {
  canonicalPlexId,
  requireCanonicalPlexId,
} from '../../server/domain/media/plexId.js'

describe('canonical Plex identifiers', () => {
  it('accepts only positive canonical decimal IDs', () => {
    expect(canonicalPlexId('1')).toBe('1')
    expect(canonicalPlexId('987654321')).toBe('987654321')
    for (const hostile of [
      '', '0', '-1', '+1', '01', ' 1', '1 ', '1/2', '1\\2', '../1',
      '1?X-Plex-Token=stolen', '1#fragment', '%2F', '%5C', '%2e%2e%2f1',
      decodeURIComponent('1%2F2'), decodeURIComponent('1%5C2'),
      decodeURIComponent('%2e%2e%2f1'),
    ]) {
      expect(canonicalPlexId(hostile), hostile).toBeNull()
      expect(() => requireCanonicalPlexId(hostile, 'test id')).toThrow('Invalid test id')
    }
  })
})
