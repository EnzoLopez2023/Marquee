# Source lineage

Marquee was extracted only from the immutable production Hearth baseline:

| Evidence | Value |
|---|---|
| Repository | `EnzoLopez2023/Hearth` |
| Version/build | `2.13.2` / `172` |
| Commit | `f0b05fc1dbf53e8aa26c215d8e858894a2793871` |
| Tree | `62cbd35861c511f7c17187c875d19ee6e353b80d` |
| Image digest | `sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140` |
| DB bytes | `950947840` |
| DB SHA-256 | `dc9fb47d269b339a3dcae37279dc3116f37a0635728a2d2b2ac2c511811a5807` |
| Marquee canonical hash | `66e9eb734289466045fd7038af072b29b1716553dc52f9a947cbd84d2bced8fe` |

Source blobs were read with `git show <commit>:<path>` from the production
Hearth repository. Local HEAD, every PostgreSQL branch/abstraction, and
post-production changes were excluded.

Owned production tables are `plex_action_log`, `sonarr_latest`,
`sonarr_summary`, and `sonarr_metric_samples`: 1,508 rows total. Only
provably Sonarr-owned shared rows are transformed: `agent_logs` rows with
`agent='sonarr'` and receipts for `/api/sonarr/ingest`. The legacy shared table
names remain owned by Watchtower.

The extracted UI lineage includes `PlexMovieInsights`, `PlexCommandCenter`,
`SonarrDashboard`, `components/duplicates`, `components/sonarr`, `PlexUsers`,
and `PlaylistBuilderDialog`. The legacy `halloween` view id was the Plex
Library and is now `/plex/library`.

`config/rehearsal-source-manifest.json` pins this evidence by approval-payload
SHA-256. A changed post-quiescence backup is accepted only with a valid
Ed25519-signed manifest carrying exact replacement evidence. Import verifies
all transformed target hashes before success; reconciliation repeats them.

Legacy `audit_log` rows are browser-originated evidence and import as
`authoritative=0`, `source=legacy_client`. The independently authoritative
`plex_action_log` retains its own immutable provenance. Legacy identity OIDs
are canonicalized to lowercase before any key or permission mapping.
