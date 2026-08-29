# Versioned service contracts

All app-to-app contracts require Marquee-audienced Entra workload access
tokens. Delegated tokens are rejected. Watchtower and Prism are bound to
distinct configured client IDs and endpoint-specific application roles. They
never expose provider credentials, URLs, media file paths, raw Sonarr
snapshots, or another application's database.

`WATCHTOWER_CLIENT_ID` and `PRISM_CLIENT_ID` are independent, optional feature
dependencies. If one is absent, only that consumer's routes return HTTP 503
with `{"error":{"code":"WORKLOAD_IDENTITY_NOT_CONFIGURED","dependency":"..."}}`.
If configured, each ID must be a GUID and the existing exact audience, issuer,
client ID, delegated-token rejection, and application-role checks remain in
force.

## Watchtower

`GET /api/contracts/v1/media-health`

Requires `Marquee.Watchtower.MediaHealth.Read` from the configured Watchtower
client. Returns `marquee.media-health.v1`: immutable build identity, overall state,
SQLite schema readiness, last observed provider results, compact Sonarr
freshness/metrics, and duplicate scan/delete totals. It reads local summaries
only and performs no provider call, integrity scan, backup, or mutation.
Any failed Sonarr endpoint degrades the response; a collection with failures
and no healthy endpoint is unavailable. Zero healthy and zero failed endpoints
also means unavailable because there is no collection evidence.

## Prism

`GET /api/contracts/v1/media/search?q=&types=&sectionIds=&limit=`

Returns `marquee.media-search.v1`. Query length is bounded, media types and
sections are allow-listed, and `limit` is capped at 50.
Requires `Marquee.Prism.Media.Read` from the configured Prism client.
Artwork is an expiring opaque `href`; `GET /api/contracts/v1/media/artwork/:reference`
requires the same workload role, streams at most 10 MiB before cancellation, and never
reveals the Plex path or provider URL.

Playlist mutations:

- `POST /api/contracts/v1/playlists/prepare`
- `POST /api/contracts/v1/playlists/commit`

Collection mutations:

- `POST /api/contracts/v1/collections/prepare`
- `POST /api/contracts/v1/collections/commit`

Prepare verifies every media id against Plex and persists a canonical payload
hash, five-minute intent, preview, and exact confirmation phrase. Commit
requires the unchanged intent, exact phrase, and `Idempotency-Key`; it claims
the intent before calling Plex and persists the result. A crash-ambiguous
external outcome is returned as `OUTCOME_UNKNOWN` and is never automatically
retried.

Prepare/commit require `Marquee.Prism.Media.Write`. An intent found in
`executing` after restart or replay is converted to `OUTCOME_UNKNOWN` and is
never dispatched again.
