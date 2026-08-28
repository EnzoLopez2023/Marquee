# Marquee

Independent Plex, Tautulli, and Sonarr operations and analytics.

Marquee is a React 19/Vite application with an Express 5 API and one app-owned
SQLite database. It contains the production-baseline Plex Library, Plex Command
Center, duplicate audit/deletion workflow, playlist builder, and Sonarr
dashboard without Hearth's global application shell.

## Development

Requires Node 24.

```bash
npm install
cp .env.example .env
npm run dev:server
npm run dev
```

`npm start` is production-only: it refuses a non-production `NODE_ENV`, requires
the built client/server artifacts, uses `/home/data/marquee.db`, and runs full
production configuration validation.

The same portable image is configured at runtime: Express serves a no-store
`/runtime-config.js` containing only the validated Entra tenant, client, and
exact `api://<client>/Marquee.User` scope before the frontend bundle starts.

Validation:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

The production database authority is `/home/data/marquee.db`, always using
SQLite `DELETE` journal mode. Import, reconciliation, backup, and restore are
explicit operator commands and never run during startup or requests.

See [source lineage](docs/SOURCE_LINEAGE.md),
[approved import](docs/IMPORT.md), [API contracts](docs/API_CONTRACTS.md),
[recovery](docs/RECOVERY.md),
[Plex TLS policy](docs/PLEX_TLS.md), and the
[parity checklist](docs/PARITY_CHECKLIST.md).
