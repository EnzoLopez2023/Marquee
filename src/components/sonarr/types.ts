export interface Paged<T> {
  records?: T[];
  totalRecords?: number;
  page?: number;
  pageSize?: number;
  truncated?: boolean;
}

export interface SonarrSeriesStatistics {
  seasonCount?: number;
  episodeCount?: number;
  episodeFileCount?: number;
  totalEpisodeCount?: number;
  sizeOnDisk?: number;
  percentOfEpisodes?: number;
}

export interface SonarrSeries {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  status?: string;
  monitored?: boolean;
  network?: string | null;
  path?: string;
  profileName?: string;
  qualityProfileId?: number;
  genres?: string[];
  nextAiring?: string | null;
  previousAiring?: string | null;
  firstAired?: string | null;
  lastAired?: string | null;
  ended?: boolean;
  seriesType?: string;
  runtime?: number;
  overview?: string;
  statistics?: SonarrSeriesStatistics;
  seasons?: Array<{
    seasonNumber?: number;
    monitored?: boolean;
    statistics?: SonarrSeriesStatistics;
  }>;
}

export interface SonarrEpisode {
  id: number;
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number | null;
  title?: string;
  airDate?: string;
  airDateUtc?: string;
  monitored?: boolean;
  hasFile?: boolean;
  overview?: string;
  episodeFileId?: number;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId?: number;
  seasonNumber?: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  releaseGroup?: string;
  sceneName?: string;
  quality?: { quality?: { name?: string }; revision?: { version?: number; real?: number } };
  mediaInfo?: {
    videoCodec?: string;
    videoResolution?: string;
    audioCodec?: string;
    audioChannels?: number;
    subtitles?: string;
  };
}

export interface SonarrQueueRecord {
  id: number;
  title?: string;
  status?: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  added?: string;
  protocol?: string;
  downloadClient?: string;
  indexer?: string;
  seriesId?: number;
  episodeId?: number;
  series?: Pick<SonarrSeries, 'id' | 'title' | 'year'>;
  episode?: Pick<SonarrEpisode, 'id' | 'title' | 'seasonNumber' | 'episodeNumber' | 'airDateUtc'>;
  quality?: { quality?: { name?: string } };
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
}

export interface SonarrHistoryRecord {
  id: number;
  seriesId?: number;
  episodeId?: number;
  sourceTitle?: string;
  eventType?: string;
  date?: string;
  qualityCutoffNotMet?: boolean;
  series?: Pick<SonarrSeries, 'id' | 'title' | 'year'>;
  episode?: Pick<SonarrEpisode, 'id' | 'title' | 'seasonNumber' | 'episodeNumber'>;
  quality?: { quality?: { name?: string } };
  data?: Record<string, string | number | boolean | null>;
}

export interface SonarrHealth {
  source?: string;
  type?: string;
  message?: string;
  wikiUrl?: string;
}

export interface SonarrDiskSpace {
  path?: string;
  label?: string;
  freeSpace?: number;
  totalSpace?: number;
}

export interface SonarrRootFolder {
  id?: number;
  path?: string;
  accessible?: boolean;
  freeSpace?: number;
  unmappedFolders?: Array<{ name?: string; path?: string; relativePath?: string }>;
}

export interface SonarrTask {
  id?: number;
  name?: string;
  taskName?: string;
  interval?: number;
  lastExecution?: string;
  lastStartTime?: string;
  lastDuration?: string;
  nextExecution?: string;
}

export interface SonarrBackup {
  id?: number;
  name?: string;
  path?: string;
  size?: number;
  time?: string;
  type?: string;
}

export interface SonarrUpdate {
  version?: string;
  branch?: string;
  releaseDate?: string;
  installed?: boolean;
  installedOn?: string;
  latest?: boolean;
  installable?: boolean;
  changes?: { new?: string[]; fixed?: string[] };
}

export interface SonarrLog {
  id?: number;
  time?: string;
  level?: string;
  logger?: string;
  message?: string;
  exception?: string;
}

export interface SonarrIntegration {
  id?: number;
  name?: string;
  enable?: boolean;
  implementation?: string;
  implementationName?: string;
  protocol?: string;
  priority?: number;
  supportsRss?: boolean;
  supportsSearch?: boolean;
  downloadClientType?: string;
}

export interface SonarrDiagnostic {
  key: string;
  path: string;
  ok: boolean;
  count: number;
  duration_ms: number;
  collected_at: number;
  error?: string;
}

export interface SonarrMetrics {
  seriesCount: number;
  monitoredSeriesCount: number;
  episodeCount: number;
  episodeFileCount: number;
  monitoredEpisodeCount: number;
  missingCount: number;
  cutoffUnmetCount: number;
  queueCount: number;
  healthIssueCount: number;
  librarySizeBytes: number;
  freeSpaceBytes: number;
}

export interface SonarrBreakdown {
  name: string;
  value: number;
}

export interface SonarrInsights {
  metrics: SonarrMetrics;
  pipeline: {
    wanted: number;
    queued: number;
    grabbed24h: number;
    imported24h: number;
    failed24h: number;
    availableEpisodes: number;
  };
  breakdowns: {
    seriesStatus: SonarrBreakdown[];
    networks: SonarrBreakdown[];
    qualityProfiles: SonarrBreakdown[];
    genres: SonarrBreakdown[];
    historyEvents: SonarrBreakdown[];
    logLevels: SonarrBreakdown[];
  };
  historyTimeline: Array<{
    date: string;
    grabbed: number;
    imported: number;
    failed: number;
    deleted: number;
    other: number;
  }>;
  incompleteSeries: Array<{
    id: number;
    title: string;
    network?: string | null;
    status?: string | null;
    monitored: boolean;
    episodeCount: number;
    episodeFileCount: number;
    percentOfEpisodes: number;
    sizeOnDisk: number;
    nextAiring?: string | null;
  }>;
  upcoming: SonarrEpisode[];
  integrations: {
    downloadClients: number;
    enabledDownloadClients: number;
    indexers: number;
    enabledIndexers: number;
    importLists: number;
    notifications: number;
    metadataConsumers: number;
  };
  collection: {
    endpointCount: number;
    healthyEndpointCount: number;
    failedEndpointCount: number;
  };
}

export interface SonarrData {
  systemStatus?: {
    instanceName?: string;
    version?: string;
    branch?: string;
    runtimeVersion?: string;
    runtimeName?: string;
    osName?: string;
    osVersion?: string;
    databaseType?: string;
    databaseVersion?: string;
    isProduction?: boolean;
    isAdmin?: boolean;
    startTime?: string;
    appData?: string;
    startupPath?: string;
  };
  health?: SonarrHealth[];
  diskSpace?: SonarrDiskSpace[];
  series?: SonarrSeries[];
  calendar?: SonarrEpisode[];
  queue?: Paged<SonarrQueueRecord>;
  queueStatus?: Record<string, unknown>;
  history?: Paged<SonarrHistoryRecord>;
  missing?: Paged<SonarrEpisode>;
  cutoff?: Paged<SonarrEpisode>;
  blocklist?: Paged<{
    id?: number;
    seriesId?: number;
    sourceTitle?: string;
    date?: string;
    protocol?: string;
    indexer?: string;
    message?: string;
    series?: Pick<SonarrSeries, 'id' | 'title'>;
    episodeIds?: number[];
  }>;
  commands?: Array<Record<string, unknown>>;
  tasks?: SonarrTask[];
  backups?: SonarrBackup[];
  updates?: SonarrUpdate[];
  logs?: Paged<SonarrLog>;
  logFiles?: Array<Record<string, unknown>>;
  updateLogFiles?: Array<Record<string, unknown>>;
  rootFolders?: SonarrRootFolder[];
  qualityProfiles?: Array<Record<string, unknown>>;
  qualityDefinitions?: Array<Record<string, unknown>>;
  customFormats?: Array<Record<string, unknown>>;
  delayProfiles?: Array<Record<string, unknown>>;
  releaseProfiles?: Array<Record<string, unknown>>;
  tags?: Array<{ id?: number; label?: string }>;
  tagDetails?: Array<Record<string, unknown>>;
  downloadClients?: SonarrIntegration[];
  indexers?: SonarrIntegration[];
  importLists?: SonarrIntegration[];
  notifications?: SonarrIntegration[];
  metadataConsumers?: SonarrIntegration[];
  remotePathMappings?: Array<Record<string, unknown>>;
  mediaManagementConfig?: Record<string, unknown>;
  namingConfig?: Record<string, unknown>;
  uiConfig?: Record<string, unknown>;
  hostConfig?: Record<string, unknown>;
  downloadClientConfig?: Record<string, unknown>;
  indexerConfig?: Record<string, unknown>;
  importListConfig?: Record<string, unknown>;
  localization?: Record<string, unknown>;
  localizationLanguage?: Record<string, unknown>;
}

export interface SonarrSnapshot {
  schema: number;
  sampled_at: number;
  agent: {
    build: number;
    poll_minutes: number;
    full_poll_minutes: number;
    full_collected_at?: number | null;
  };
  source: {
    label?: string;
    host?: string;
    version?: string | null;
    branch?: string | null;
    runtimeVersion?: string | null;
    databaseType?: string | null;
  };
  collection: {
    mode: 'fast' | 'full';
    duration_ms: number;
    endpoints: SonarrDiagnostic[];
    unavailable?: Array<{ key: string; path: string; error?: string }>;
  };
  data: SonarrData;
  insights: SonarrInsights;
  detail?: {
    episodeSeriesCount: number;
    episodeFileSeriesCount: number;
  };
}

export interface SonarrDashboardResponse {
  ok: boolean;
  present: boolean;
  received_at?: number;
  age_seconds?: number;
  stale?: boolean;
  stale_after_seconds?: number;
  snapshot?: SonarrSnapshot;
  error?: string;
}

export interface SonarrTrendPoint {
  sampled_at: number;
  series_count?: number | null;
  monitored_series_count?: number | null;
  episode_count?: number | null;
  episode_file_count?: number | null;
  monitored_episode_count?: number | null;
  missing_count?: number | null;
  cutoff_unmet_count?: number | null;
  queue_count?: number | null;
  health_issue_count?: number | null;
  library_size_bytes?: number | null;
  free_space_bytes?: number | null;
}

export interface SonarrSeriesDetailResponse {
  ok: boolean;
  stale: boolean;
  series: SonarrSeries;
  episodes: SonarrEpisode[];
  episodeFiles: SonarrEpisodeFile[];
  error?: string;
}
