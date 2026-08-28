import { describe, expect, it } from 'vitest'
import {
  redactAbsoluteFilesystemString,
  sanitizeSonarrData,
} from '../../server/domain/sonarr/sanitize.js'

describe('Sonarr response path sanitization', () => {
  it('removes nested filesystem paths without removing non-path data', () => {
    expect(sanitizeSonarrData({
      series: [{ id: 1, title: 'Show', path: 'P:\\TV\\Show', rootFolderPath: 'P:\\TV' }],
      files: [{ id: 2, relativePath: 'Season 1\\episode.mkv', size: 10 }],
      source: {
        startupPath: 'C:\\ProgramData\\Sonarr\\bin',
        appData: 'C:\\ProgramData\\Sonarr',
      },
      history: [{ importedPath: 'P:\\TV\\Show\\episode.mkv', droppedPath: 'D:\\downloads\\episode.mkv' }],
      logs: [
        { message: 'Imported P:\\TV\\Show\\episode.mkv successfully' },
        { message: 'Moved /mnt/tv/Show/episode.mkv successfully' },
        { message: 'GET /api/v3/series succeeded' },
      ],
      rootFolders: [{ path: 'P:\\TV' }],
      alternatePaths: ['P:\\TV\\Show'],
      diagnostics: { endpointPath: '/api/v3/series', status: 'ok' },
    })).toEqual({
      series: [{ id: 1, title: 'Show' }],
      files: [{ id: 2, size: 10 }],
      source: {},
      history: [{}],
      logs: [
        { message: '[redacted filesystem path]' },
        { message: '[redacted filesystem path]' },
        { message: 'GET /api/v3/series succeeded' },
      ],
      diagnostics: { status: 'ok' },
    })
  })

  it('redacts absolute path strings without changing ordinary text', () => {
    expect(redactAbsoluteFilesystemString('C:\\ProgramData\\Sonarr')).toBe(
      '[redacted filesystem path]',
    )
    expect(redactAbsoluteFilesystemString('Failure at \\\\server\\share\\file.mkv')).toBe(
      '[redacted filesystem path]',
    )
    expect(redactAbsoluteFilesystemString('error(C:\\ProgramData\\Sonarr\\config.xml)')).toBe(
      '[redacted filesystem path]',
    )
    expect(redactAbsoluteFilesystemString('error(\\\\server\\share\\file.mkv)')).toBe(
      '[redacted filesystem path]',
    )
    expect(redactAbsoluteFilesystemString('error:/var/lib/sonarr/config.xml')).toBe(
      '[redacted filesystem path]',
    )
    expect(redactAbsoluteFilesystemString('Imported /home/sonarr/file.mkv')).toBe(
      '[redacted filesystem path]',
    )
    for (const path of [
      '/private/var/db/sonarr',
      '/usr/local/sonarr/config',
      '/arbitrary/private/file',
      'Failure at /etc/sonarr/config.xml',
      '/data',
      '/mnt',
      '/etc',
    ]) {
      expect(redactAbsoluteFilesystemString(path), path).toBe('[redacted filesystem path]')
    }
    expect(redactAbsoluteFilesystemString('GET /api/v3/series succeeded')).toBe(
      'GET /api/v3/series succeeded',
    )
    expect(redactAbsoluteFilesystemString('Fetched https://sonarr.example/api/v3/series')).toBe(
      'Fetched https://sonarr.example/api/v3/series',
    )
    expect(redactAbsoluteFilesystemString('Path analysis completed normally')).toBe(
      'Path analysis completed normally',
    )
  })
})
