# Production deployment

Marquee is a single Node 24 Linux container: one Express process serves the SPA
and API, and one `better-sqlite3` connection owns `/home/data/marquee.db`.
The image runs as UID/GID 10001 behind `dumb-init`. `/home/data` must be an
Azure App Service persistent storage mount. Production must remain one worker
and one App Service instance; SQLite uses `journal_mode=DELETE` and a bounded
busy timeout. Deployment never migrates production data or replaces, copies,
or clears `/home/data`.

## External prerequisites

The workflow consumes existing resources only. Operators must create and
configure these outside this repository:

1. A protected GitHub `production` environment with required reviewers as
   appropriate.
2. Repository or `production` environment variables `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_NAME`, `WEBAPP_NAME`, and
   `RESOURCE_GROUP`.
3. An Entra federated credential on `AZURE_CLIENT_ID` whose subject matches this
   repository and protected environment, plus only the existing ACR push and
   App Service deployment permissions it needs.
4. An existing ACR and Linux App Service configured to pull from it. App Service
   persistent storage must be enabled, `WEBSITES_PORT=3001`, and scaling must be
   fixed at one instance/process.
5. A combined Marquee SPA/API Entra registration. Its application ID is
   `AZURE_AD_CLIENT_ID`; its identifier URI is `api://<Marquee client id>`; its
   delegated scope is `Marquee.User`; and its workload application roles are
   the Watchtower read role plus Prism read and write roles documented in
   [API_CONTRACTS.md](API_CONTRACTS.md). Configure the production SPA redirect
   and logout URIs on this same registration. Record its
   `accessTokenAcceptedVersion`: v2 tokens use the client-ID GUID as `aud`, while
   v1 tokens use the identifier URI.

The repository does not provision or modify Azure, Entra, GitHub settings,
environments, variables, secrets, DNS, providers, or production data.

## App Service settings

### Startup-critical

| Setting | Contract |
|---|---|
| `NODE_ENV` | `production` (baked into the image) |
| `PORT` | `3001` (baked into the image) |
| `DB_PATH` | `/home/data/marquee.db` |
| `MARQUEE_ARTIFACT_ROOT` | `/home/data/marquee-artifacts` |
| `AZURE_AD_TENANT_ID` | Tenant used by MSAL and strict token validation |
| `AZURE_AD_CLIENT_ID` | Combined Marquee SPA/API application ID |
| `AZURE_AD_AUDIENCE` | Client-ID GUID for v2 tokens, or exactly `api://<Marquee client id>` for v1 tokens |
| `ADMIN_OID` | Initial and invariant Marquee administrator object ID |

`AAD_TENANT_ID` is a deprecated compatibility alias for
`AZURE_AD_TENANT_ID`. Do not set both. If both exist and differ, startup fails;
all workflow and current documentation use `AZURE_AD_TENANT_ID`, the canonical
application-consumed key. `MARQUEE_BOOTSTRAP_ADMIN_OID` is an explicit
compatibility fallback for `ADMIN_OID`, not a second administrator.
Startup accepts only the two audience forms belonging to the same combined
registration. It never accepts an unrelated URI, and token validation still
requires the configured exact audience, tenant, issuer, scope, client, and
application role. `/api/config` reports that non-secret audience so the
deployment agreement probe verifies the same runtime choice the API enforces.

The Docker image bakes immutable semantic version, source commit, workflow run
ID, and build time into `build-metadata.json`. The runtime copy of commit and
build ID must agree with that file or startup fails. `/version.json`,
`/api/version`, `/api/live`, and `/api/ready` report this identity. Runtime image
digest is omitted unless a platform supplies and explicitly marks a verified
`MARQUEE_IMAGE_DIGEST`; the deployment workflow therefore treats the ACR/App
Service digest as authoritative instead of claiming an unverifiable runtime
digest.

### Feature-gated settings and secrets

`WATCHTOWER_CLIENT_ID` and `PRISM_CLIENT_ID` are optional. Missing values do not
prevent Marquee startup or user login; only the corresponding workload contract
routes return explicit 503 responses. A present value must be a GUID. Role-name
settings may override the documented defaults but do not weaken token
validation.

Provider settings (`PLEX_*`, `TAUTULLI_*`, `OMDB_API_KEY`, `ANTHROPIC_API_KEY`,
`VIBE_OPENAI_*`, and `SONARR_INGEST_TOKEN`) gate their own features. Store
provider credentials as Key Vault-backed App Service references using the
existing managed identity. Do not put them in GitHub variables, image layers,
or browser runtime config. Backup storage settings are required only for the
explicit off-host recovery command.

## Delivery behavior

CI runs strict client/server TypeScript checks, ESLint, all tests, separate
client and server production builds, production and complete dependency audits,
the no-PostgreSQL/Drizzle/WAL architecture gate, and a Linux image smoke test.
The smoke runs as the production user with explicit throwaway `/tmp` database
and artifact paths enabled only by `CI=true` plus
`MARQUEE_EPHEMERAL_SMOKE=true`; normal production paths must remain under
`/home/data`.

Deployment builds and pushes a run-unique ACR tag, resolves and verifies its
exact digest, generates an SBOM, blocks high/critical fixed vulnerabilities,
signs and attests that digest, and deploys App Service by digest. It does not
write app settings. Version, API version, liveness, readiness, database journal
mode, and public runtime config must agree before the digest receives the
`production` promotion tag. The canary never uses `latest`. Any failure or
cancellation after the deploy step restores the previously captured
digest-pinned image and restarts the app.

Manual rollback uses the same `az webapp config container set` digest-pinned
operation. Backup, restore, and data recovery remain the explicit procedures in
[RECOVERY.md](RECOVERY.md), never deployment steps.
