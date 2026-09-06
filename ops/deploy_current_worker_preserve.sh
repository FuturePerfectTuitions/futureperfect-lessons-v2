#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WRANGLER_VERSION:=4.125.0}"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/fpt-worker-settings.json
jq -e '.success == true' /tmp/fpt-worker-settings.json >/dev/null
plain(){ jq -r --arg n "$1" '[.result.bindings[]|select(.name==$n and .type=="plain_text")|.text][0] // ""' /tmp/fpt-worker-settings.json; }
field(){ jq -r --arg n "$1" --arg t "$2" --arg f "$3" '[.result.bindings[]|select(.name==$n and .type==$t)|.[$f]][0] // ""' /tmp/fpt-worker-settings.json; }
STUDENTS="$(field STUDENTS_KV kv_namespace namespace_id)"
LESSONS="$(field LESSONS_KV kv_namespace namespace_id)"
DBID="$(field DB d1 id)"
R2="$(field MATERIALS_R2 r2_bucket bucket_name)"
for value in "$STUDENTS" "$LESSONS" "$DBID" "$R2"; do test -n "$value"; done
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-worker-settings.json >/tmp/fpt-secrets-before.json
{
  printf 'name = "%s"\n' "$WORKER_NAME"
  printf 'main = "src/index-phase19-access.js"\n'
  printf 'compatibility_date = "2026-08-20"\nkeep_vars = true\nworkers_dev = true\n\n[vars]\n'
  printf 'ENVIRONMENT = "%s"\n' "$(plain ENVIRONMENT)"
  printf 'ALLOWED_ORIGINS = "%s"\n' "$(plain ALLOWED_ORIGINS)"
  printf 'DEV_LOGIN_ALLOWLIST = "%s"\n' "$(plain DEV_LOGIN_ALLOWLIST)"
  printf 'PROD_LOGIN_ALLOWLIST = "%s"\n' "$(plain PROD_LOGIN_ALLOWLIST)"
  printf 'STUDENT_LOGIN_ENABLED = "%s"\n' "$(plain STUDENT_LOGIN_ENABLED)"
  printf '\n[[kv_namespaces]]\nbinding = "STUDENTS_KV"\nid = "%s"\n' "$STUDENTS"
  printf '\n[[kv_namespaces]]\nbinding = "LESSONS_KV"\nid = "%s"\n' "$LESSONS"
  printf '\n[[r2_buckets]]\nbinding = "MATERIALS_R2"\nbucket_name = "%s"\n' "$R2"
  printf '\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fpt_portal_v2_db"\ndatabase_id = "%s"\n' "$DBID"
} > worker/wrangler.runtime-preserve.toml
npx --yes wrangler@"$WRANGLER_VERSION" deploy --config worker/wrangler.runtime-preserve.toml --keep-vars --message "${DEPLOY_MESSAGE:-Portal V2 production update}"
curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/fpt-worker-settings-after.json
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-worker-settings-after.json >/tmp/fpt-secrets-after.json
cmp -s /tmp/fpt-secrets-before.json /tmp/fpt-secrets-after.json
