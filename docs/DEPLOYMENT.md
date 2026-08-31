# Production deployment

Marquee runs as one Node 24 Linux container. Express serves the SPA and API, and
one `better-sqlite3` connection owns `/home/data/marquee.db`. The App Service
must use persistent storage and remain at one worker and one instance.

## Required external configuration

The deployment workflow expects these repository variables:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `RESOURCE_GROUP`
- `WEBAPP_NAME`

`AZURE_CLIENT_ID` must identify an Entra application with a GitHub Actions OIDC
federated credential. It needs permission to push
`acrenzolopez01.azurecr.io/marquee` images and update the existing Marquee Web
App. The Web App managed identity needs permission to pull the same ACR
repository. The workflow does not create these resources or assignments.

The existing App Service must expose port 3001 and persist `/home/data`.

## App Service settings

| Setting | Value |
|---|---|
| `WEBSITES_PORT` | `3001` |
| `DB_PATH` | `/home/data/marquee.db` |
| `MARQUEE_ARTIFACT_ROOT` | `/home/data/marquee-artifacts` |
| `AZURE_AD_TENANT_ID` | Optional Marquee Entra tenant ID |
| `AZURE_AD_CLIENT_ID` | Optional combined Marquee SPA/API client ID |
| `AZURE_AD_AUDIENCE` | Optional client ID or `api://<client-id>` |
| `ADMIN_OID` | Optional Marquee administrator object ID |
| `WATCHTOWER_WORKLOAD_TENANT_ID` | Compute tenant that issues Watchtower managed-identity tokens |
| `WATCHTOWER_WORKLOAD_AUDIENCE` | Exact audience of the Marquee workload API registration |
| `WATCHTOWER_CLIENT_ID` | Watchtower managed identity application/client ID |
| `WATCHTOWER_APP_ROLE` | `Marquee.Watchtower.MediaHealth.Read` |

Identity integrations are deferred when unavailable and do not block process
startup, `/version.json`, `/api/version`, `/api/live`, or `/api/ready`. Missing
user-login configuration makes `/api/config`, protected user APIs, and the
sign-in UI explicitly unavailable with HTTP 503 behavior. Missing `ADMIN_OID`
makes admin APIs unavailable. Missing `WATCHTOWER_CLIENT_ID` or
`PRISM_CLIENT_ID` makes only that workload's contract endpoints unavailable.
Configured IDs remain strictly validated.

The Watchtower route additionally requires its workload tenant and audience.
These values are intentionally separate from the user-facing Marquee
registration: a managed-identity token is verified against its compute tenant
and workload API audience, while browser tokens continue to use
`AZURE_AD_TENANT_ID` and `AZURE_AD_AUDIENCE`. The workload resource service
principal must expose `Marquee.Watchtower.MediaHealth.Read` to applications,
and the Watchtower managed identity must have that app-role assignment.

When configured, the combined SPA/API registration uses identifier URI
`api://<Marquee client id>` and delegated scope `Marquee.User`.

Provider credentials remain App Service or Key Vault settings and are never
compiled into the browser bundle. `/api/config` exposes only the non-secret
tenant, client, audience, and delegated scope values needed by MSAL.

## Delivery

The delivery workflow installs dependencies and builds the client and server.
For pushes to `main` and manual runs, its deployment job signs in to Azure with
OIDC, builds a run-specific image locally on the GitHub runner, pushes it to the
existing shared ACR, and configures the existing Web App to run that image. It
does not modify `/home/data`.

After deployment, the workflow reports `/api/live` and `/api/ready` status.
Health reporting does not block the completed deployment.
