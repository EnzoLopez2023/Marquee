# Production parity checklist

## Plex Library

- [x] Movie-section selection and full library loading
- [x] Search, filters, sorting, random pick, and media detail
- [x] OMDb detail and server-side image proxy
- [x] Natural-language playlist builder with streamed matching/creation
- [x] App-local read-only role behavior

## Command Center

- [x] Activity, home stats, date/day/hour/platform analytics
- [x] History and library pagination/detail
- [x] Library playlists and playlist items
- [x] Plex users, profiles, player stats, and history
- [x] Tautulli/Plex/notification logs
- [x] AI insights and cool facts

## Duplicates

- [x] Collapse normalized physical file references first
- [x] Iterate every metadata `Media` and `Part`
- [x] Resolution-aware and word-boundary 3D-aware grouping
- [x] GUID-less mandatory manual review
- [x] Quality score, short-runtime penalty, and 5% threshold
- [x] All six server-side re-verification guards
- [x] Specific-media deletion for Plex multi-version metadata
- [x] No metadata-wide delete fallback when a media id is absent
- [x] Append-only cancellation/failure/verification/success snapshots
- [x] Audit paging and cumulative savings

## Sonarr

- [x] Gzip/base64 limits and schema/time validation
- [x] Constant-time bearer authentication
- [x] Transactional delivery receipts and duplicate acknowledgement
- [x] Latest/summary monotonic upserts
- [x] 15-minute samples and 365-day retention
- [x] Dashboard, per-series detail, trends, export, and freshness
- [x] Durable agent queue and Marquee-specific log ingest

## Independence

- [x] Real URL routing; no Hearth `AppView` shell
- [x] Marquee-specific Entra audience and OID-keyed roles
- [x] Exact delegated user scope and segregated workload client/app roles
- [x] Feature-scoped server-side mutation authorization
- [x] Provider secrets stay server-side
- [x] Every Plex/Tautulli/Sonarr read is server-authorized by owning feature
- [x] General media responses remove filesystem paths; duplicates retain them only behind destructive authorization
- [x] Canonical numeric Plex IDs precede every token-bearing upstream path
- [x] Plex route ownership matches Express case/trailing-slash behavior
- [x] Plex TLS verifies by default with private-CA/pin support and explicit degraded insecure compatibility
- [x] Tautulli image proxy accepts only bounded relative Plex artwork and rejects SSRF/non-image/oversize responses
- [x] Protected artwork uses bearer-authenticated object URLs with deduplication and race-safe revocation
- [x] SPA and API share the exact `Marquee.User` delegated scope
- [x] Production start forces validated production mode and built artifacts
- [x] Portable runtime-config.js supplies validated nonsecret Entra values before bundle startup
- [x] Sonarr endpoint failures retain last successful values and gate full-poll completion
- [x] Failed full polls record attempts and wait for configured cadence before exhaustive retry
- [x] Successful empty series clears detail maps; failed series retains prior detail
- [x] Sonarr dashboard/detail/export remove all filesystem path-bearing fields
- [x] Agent sanitizes the exact compressed snapshot before durable queue/transmission/persistence
- [x] Absolute Windows/UNC/POSIX path strings and plural path/folder/directory keys are redacted
- [x] Agent log paths are redacted before shipping, at ingest, and on admin reads
- [x] Decoded Sonarr snapshots are sanitized before summary/metric/persistence work
- [x] Watchtower media health reflects partial and total Sonarr endpoint failure
- [x] Zero Sonarr endpoint evidence is unavailable
- [x] Committed Plex deletes return an explicit nonretryable result if final audit append fails
- [x] Recovery verifies exact table/index/trigger SQL hashes
- [x] Sonarr durable queue compacts coalescing immediately and enforces actual file bytes
- [x] Dead-letter archival failure retains queue entries and propagates
- [x] Queue append fsyncs before eligibility; corrupt/torn rows are durably quarantined or startup fails
- [x] Duplicate deletion UI requires feature edit and destructive role together
- [x] Canonical GUID/resolution/edition locks serialize inverse duplicate deletes
- [x] Renewable singleton SQLite lease fences requests and aborts in-flight deletes on loss
- [x] Unresolved permissions keep all edit/delete controls disabled
- [x] Admin role replacement and authoritative audit commit atomically
- [x] Production requires a canonical admin or explicit bootstrap-admin OID
- [x] Duplicate scan/audit path responses require edit plus destructive role
- [x] General Plex/Tautulli media payloads remove Location/path keys and absolute path strings
- [x] Legacy browser audit imports are non-authoritative `legacy_client` evidence
- [x] Import success verifies every transform against pinned or Ed25519-approved evidence
- [x] Mixed-case configured/token/legacy GUIDs canonicalize before identity keys
- [x] Typed delete API errors always render as safe strings
- [x] Sonarr candidate config passes `--check` before atomic promotion
- [x] Production unknown `/api` and `/api/*` return JSON 404 before SPA fallback
- [x] Client telemetry is allow-listed, server-timestamped, and explicitly non-authoritative
- [x] Isolated SQLite with no PostgreSQL dependency or compatibility layer
- [x] Bounded liveness/readiness and explicit recovery commands
- [x] Recovery requires the exact Marquee marker and migration checksums
- [x] Watchtower and Prism versioned contracts; no shared database
