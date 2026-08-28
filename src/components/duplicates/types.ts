// Shared types for the Duplicates feature. Mirrors the JSON shape returned by
// the routes/plex-duplicates.js endpoints.

export interface DuplicateCopy {
  ratingKey:      string                  // canonical rating key (sent to DELETE)
  ratingKeys:     string[]                // every Plex rating key pointing at this same file
  mediaId:        string | null           // specific Plex Media id — required to delete the right version when one metadata has multiple Media
  mediaIds:       string[]                // every Plex Media id across sections
  libraryId:      string                  // canonical library id (back-compat)
  libraryIds:     string[]                // every library that indexes this file
  libraryTitle:   string                  // canonical library name (back-compat)
  libraryTitles:  string[]                // every library that indexes this file (display)
  is3D:           boolean                 // detected from file path — 3D editions group separately
  partId:         string | null           // Plex Part id for this specific file
  filePath:       string | null
  fileSize:       number
  resolution:     string | null
  bitrate:        number
  videoCodec:     string | null
  audioCodec:     string | null
  audioChannels:  number
  container:      string | null
  duration:       number      // ms
  /** Per FILE — the part's own timestamp. 0 when Plex didn't supply one. */
  fileUpdatedAt:  number      // unix seconds
  /** The four below are per MOVIE, so they match across every copy of a title. */
  addedAt:        number      // unix seconds
  updatedAt:      number
  viewCount:      number
  lastViewedAt:   number
  thumb:          string | null
  art:            string | null
  summary:        string | null
  qualityScore:   number
  qualityReasons: string[]
  isKeeper:       boolean
  isDeleteTarget: boolean
}

export interface DuplicateGroup {
  key:                    string
  title:                  string
  year:                   number | null
  guid:                   string | null
  resolution:             string | null    // canonical resolution for this group ("4k", "1080", etc.)
  is3D:                   boolean          // group-wide flag — every copy is a 3D edition
  manualReviewRequired:   boolean
  potentialSavingsBytes:  number
  copies:                 DuplicateCopy[]
}

export interface ScanResult {
  groups:                     DuplicateGroup[]
  unmatchedGroups:            DuplicateGroup[]
  scannedAt:                  number
  totalMoviesScanned:         number      // raw row count across every library (counts the same file N times)
  totalDistinctFiles:         number      // physical file count after same-file collapse
  totalDuplicateGroups:       number
  totalUnmatchedGroups:       number
  totalPotentialSavingsBytes: number
}

export interface ServerConfig {
  allowMediaDeletion: boolean
  serverName:         string | null
  machineId:          string | null
  version:            string | null
}

export interface SavingsSummary {
  totalBytesSaved: number
  deleteCount:     number
  firstDeleteAt:   number | null
  lastDeleteAt:    number | null
  byMonth:         { month: string; bytes: number; count: number }[]
}

export interface AuditLogEntry {
  id:              number
  ts:              number
  action:          'delete' | 'delete_attempt' | 'scan' | string
  status:          'success' | 'failed' | 'cancelled' | 'verify_failed' | string
  rating_key:      string | null
  library_id:      string | null
  library_title:   string | null
  movie_guid:      string | null
  title:           string | null
  year:            number | null
  file_path:       string | null
  file_size:       number | null
  duration_ms:     number | null
  bitrate_kbps:    number | null
  resolution:      string | null
  video_codec:     string | null
  audio_codec:     string | null
  audio_channels:  number | null
  container:       string | null
  kept_rating_key: string | null
  kept_file_path:  string | null
  snapshot_json:   string | null
  snapshot:        Record<string, unknown> | null
  error_message:   string | null
  user_email:      string | null
}

export interface AuditLogResponse {
  total:   number
  limit:   number
  offset:  number
  entries: AuditLogEntry[]
}

export interface DeleteRequest {
  deleteRatingKey:        string
  expectedGuid:           string
  expectedTitle:          string
  expectedYear:           number | null
  expectedFilePath:       string
  expectedMediaId:        string
  expectedLibraryTitles?: string[]       // informational — included in audit log
  expectedRatingKeys?:    string[]       // sibling rating keys for the same file
  keeperRatingKey:        string
  keeperMediaId:          string
  keeperFilePath:         string
  expectedResolution:     string
  expectedIs3D:           boolean
  confirmToken:           'DELETE'
}

export interface DeleteResponse {
  success:         boolean
  deletedRatingKey: string
  deletedFilePath:  string
  deletedFileSize:  number | null
  title:           string
  year:            number | null
}

// Palette shape mirrors the `useC()` hook in PlexCommandCenter.tsx — we
// receive an instance by prop so child components don't need to re-derive it.
export interface DupPalette {
  bg:      string
  surface: string
  paper:   string
  border:  string
  ink:     string
  muted:   string
  rust:    string
  rustBg:  string
  green:   string
  red:     string
  blue:    string
  amber:   string
  purple:  string
}
