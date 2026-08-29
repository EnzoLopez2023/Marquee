#!/usr/bin/env bash
set -euo pipefail

: "${ACR:?ACR is required}"
: "${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
: "${WEBAPP_NAME:?WEBAPP_NAME is required}"

ARM_TOKEN="$(az account get-access-token \
  --resource https://management.azure.com/ \
  --query accessToken -o tsv)"
DEPLOY_OBJECT_ID="$(ARM_TOKEN="$ARM_TOKEN" node -e '
  const token = process.env.ARM_TOKEN || "";
  const part = token.split(".")[1] || "";
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (typeof claims.oid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.oid)) {
    throw new Error("Azure OIDC access token has no valid oid claim");
  }
  process.stdout.write(claims.oid.toLowerCase());
')"
unset ARM_TOKEN

ACR_ID="$(az acr show --name "$ACR" --query id -o tsv)"
WEBAPP_ID="$(az webapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEBAPP_NAME" \
  --query id -o tsv)"
WEBAPP_PULL_OBJECT_ID="$(az webapp identity show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEBAPP_NAME" \
  --query principalId -o tsv)"
if [[ ! "$WEBAPP_PULL_OBJECT_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "::error::Marquee Web App has no valid system-assigned managed identity"
  exit 1
fi

list_roles() {
  az role assignment list \
    --assignee-object-id "$1" \
    --scope "$2" \
    --include-groups \
    --include-inherited \
    --fill-principal-name false \
    --fill-role-definition-name false \
    --query '[].{condition:condition,principalId:principalId,roleDefinitionId:roleDefinitionId,scope:scope}' \
    -o json
}

work_directory="$(mktemp -d)"
trap 'rm -rf "$work_directory"' EXIT
list_roles "$DEPLOY_OBJECT_ID" "$ACR_ID" > "$work_directory/deploy-acr.json"
list_roles "$DEPLOY_OBJECT_ID" "$WEBAPP_ID" > "$work_directory/deploy-webapp.json"
list_roles "$WEBAPP_PULL_OBJECT_ID" "$ACR_ID" > "$work_directory/webapp-pull.json"

node scripts/validate-deployment-roles.mjs \
  --acr-id "$ACR_ID" \
  --webapp-id "$WEBAPP_ID" \
  --deploy-object-id "$DEPLOY_OBJECT_ID" \
  --webapp-pull-object-id "$WEBAPP_PULL_OBJECT_ID" \
  --deploy-acr-assignments "$work_directory/deploy-acr.json" \
  --deploy-webapp-assignments "$work_directory/deploy-webapp.json" \
  --webapp-pull-assignments "$work_directory/webapp-pull.json"
