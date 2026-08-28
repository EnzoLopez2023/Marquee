import { describe, expect, it } from 'vitest'
import {
  detectThreeD,
  groupDuplicates,
  normalizeResolution,
} from '../../server/domain/duplicates/grouping.js'

const movie = (
  ratingKey: string,
  file: string,
  resolution = '1080',
  bitrate = 5_000,
  duration = 7_200_000,
) => ({
  ratingKey,
  guid: 'imdb://tt1',
  title: 'Movie',
  year: 2020,
  duration,
  Media: [{
    id: `m${ratingKey}`,
    videoResolution: resolution,
    bitrate,
    duration,
    Part: [{ id: `p${ratingKey}`, file, size: 1_000, key: `/library/parts/${ratingKey}/1700000000/file.mkv` }],
  }],
})

describe('duplicate grouping parity', () => {
  it('collapses case-insensitive same-file references before grouping', () => {
    const result = groupDuplicates([
      { section: { key: '1', title: 'Movies' }, metadata: [movie('1', 'P:\\Movies\\Film.mkv')] },
      { section: { key: '2', title: 'Kids' }, metadata: [movie('2', ' p:\\movies\\film.MKV ')] },
    ])
    expect(result.totalDistinctFiles).toBe(1)
    expect(result.totalDuplicateGroups).toBe(0)
  })

  it('keeps resolutions and 3D editions in separate groups', () => {
    const result = groupDuplicates([{
      section: { key: '1', title: 'Movies' },
      metadata: [
        movie('1', '/Movie/1080.mkv', '1080'),
        movie('2', '/Movie/4k.mkv', '2160'),
        movie('3', '/Movie/3D/movie.mkv', '1080'),
      ],
    }])
    expect(result.totalDuplicateGroups).toBe(0)
    expect(normalizeResolution('576')).toBe('sd')
    expect(normalizeResolution('2160')).toBe('4k')
  })

  it('uses a path word boundary for 3D detection', () => {
    expect(detectThreeD('/Movies/Avatar 3D/file.mkv')).toBe(true)
    expect(detectThreeD('/Movies/FX3D/file.mkv')).toBe(false)
    expect(detectThreeD('/Movies/3DStudio/file.mkv')).toBe(false)
  })

  it('requires manual review below five percent and penalizes short samples', () => {
    const close = groupDuplicates([{
      section: { key: '1', title: 'Movies' },
      metadata: [
        movie('1', '/Movie/a.mkv', '1080', 5_000),
        movie('2', '/Movie/b.mkv', '1080', 4_900),
      ],
    }])
    expect(close.groups[0].manualReviewRequired).toBe(true)

    const sample = groupDuplicates([{
      section: { key: '1', title: 'Movies' },
      metadata: [
        movie('1', '/Movie/full.mkv', '1080', 4_000, 7_200_000),
        movie('2', '/Movie/sample.mkv', '1080', 20_000, 120_000),
      ],
    }])
    expect(sample.groups[0].copies[0].filePath).toContain('full')
    expect(sample.groups[0].copies[1].qualityReasons.join(' ')).toContain('Short runtime')
  })
})
