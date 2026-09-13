#!/usr/bin/env bash
set -Eeuo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${REBUILD_SHADOW_KV_NAMESPACE_ID:?}"
: "${REBUILD_SHADOW_DB_ID:?}"
: "${REBUILD_SHADOW_DB_NAME:=fpt_portal_v2_rebuild_shadow_reconciliation}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WRANGLER_VERSION:=4.125.0}"

WORKER_ENTRYPOINT='src/index-checkpoint4-shadow.js'
test -f "worker/${WORKER_ENTRYPOINT}"

# Preserve the exact legacy catalogue-generation step used by the accepted
# production deployment path. The shadow wrapper must not alter legacy reads.
rm -rf /tmp/fpt-navigation-package
node --experimental-default-type=module scripts/phase11-apply-package.mjs \
  --write-dir /tmp/fpt-navigation-package >/tmp/fpt-navigation-package.log
MANIFEST='worker/src/phase11-navigation-manifest.generated.js'
grep -Fq 'Generated from the immutable Phase 11 canonical catalogue.' "$MANIFEST"
grep -Fq 'Navigation manifest SHA-256: d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083' "$MANIFEST"
jq -e '.navigationManifestLessons == 369 and .navigationManifestCurricula == 11 and .navigationManifestSha256 == "d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083"' \
  /tmp/fpt-navigation-package/phase11-apply-summary.json >/dev/null

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/cp4-worker-settings-before.json
jq -e '.success == true' /tmp/cp4-worker-settings-before.json >/dev/null
plain(){ jq -r --arg n "$1" '[.result.bindings[]|select(.name==$n and .type=="plain_text")|.text][0] // ""' /tmp/cp4-worker-settings-before.json; }
field(){ jq -r --arg n "$1" --arg t "$2" --arg f "$3" '[.result.bindings[]|select(.name==$n and .type==$t)|.[$f]][0] // ""' /tmp/cp4-worker-settings-before.json; }
STUDENTS="$(field STUDENTS_KV kv_namespace namespace_id)"
LESSONS="$(field LESSONS_KV kv_namespace namespace_id)"
DBID="$(field DB d1 id)"
R2="$(field MATERIALS_R2 r2_bucket bucket_name)"
PARENT_EMAIL_TEST_TO="$(plain PARENT_EMAIL_TEST_TO)"
for value in "$STUDENTS" "$LESSONS" "$DBID" "$R2"; do test -n "$value"; done

test "$STUDENTS" = 'c9723c8806334e4ea54d1b456d31b794'
test "$LESSONS" = '49619b1a24b244bc8aaa6223fcd24e80'
test "$DBID" = '97250a54-fa91-45ad-a002-3c4566b1fc38'
test "$R2" = 'fpt-materials-dev'
test "$REBUILD_SHADOW_KV_NAMESPACE_ID" != "$STUDENTS"
test "$REBUILD_SHADOW_KV_NAMESPACE_ID" != "$LESSONS"
test "$REBUILD_SHADOW_DB_ID" != "$DBID"

jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/cp4-worker-settings-before.json >/tmp/cp4-secrets-before.json

{
  printf 'name = "%s"\n' "$WORKER_NAME"
  printf 'main = "%s"\n' "$WORKER_ENTRYPOINT"
  printf 'compatibility_date = "2026-08-20"\nkeep_vars = true\nworkers_dev = true\n\n[vars]\n'
  printf 'ENVIRONMENT = "%s"\n' "$(plain ENVIRONMENT)"
  printf 'ALLOWED_ORIGINS = "%s"\n' "$(plain ALLOWED_ORIGINS)"
  printf 'DEV_LOGIN_ALLOWLIST = "%s"\n' "$(plain DEV_LOGIN_ALLOWLIST)"
  printf 'PROD_LOGIN_ALLOWLIST = "%s"\n' "$(plain PROD_LOGIN_ALLOWLIST)"
  printf 'STUDENT_LOGIN_ENABLED = "%s"\n' "$(plain STUDENT_LOGIN_ENABLED)"
  printf 'PARENT_EMAIL_TEST_TO = "%s"\n' "$PARENT_EMAIL_TEST_TO"
  printf 'CHECKPOINT4_SHADOW_MODE = "legacy-authoritative"\n'
  printf '\n[[send_email]]\nname = "EMAIL"\n'
  printf '\n[[kv_namespaces]]\nbinding = "STUDENTS_KV"\nid = "%s"\n' "$STUDENTS"
  printf '\n[[kv_namespaces]]\nbinding = "LESSONS_KV"\nid = "%s"\n' "$LESSONS"
  printf '\n[[kv_namespaces]]\nbinding = "REBUILD_SHADOW_KV"\nid = "%s"\n' "$REBUILD_SHADOW_KV_NAMESPACE_ID"
  printf '\n[[r2_buckets]]\nbinding = "MATERIALS_R2"\nbucket_name = "%s"\n' "$R2"
  printf '\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fpt_portal_v2_db"\ndatabase_id = "%s"\n' "$DBID"
  printf '\n[[d1_databases]]\nbinding = "REBUILD_SHADOW_DB"\ndatabase_name = "%s"\ndatabase_id = "%s"\n' "$REBUILD_SHADOW_DB_NAME" "$REBUILD_SHADOW_DB_ID"
} > worker/wrangler.checkpoint4-shadow.toml

npx --yes wrangler@"$WRANGLER_VERSION" deploy \
  --config worker/wrangler.checkpoint4-shadow.toml --keep-vars \
  --message "${DEPLOY_MESSAGE:-Portal V2 Checkpoint 4 production shadow compatibility}"

curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/cp4-worker-settings-after.json
jq -e '.success == true' /tmp/cp4-worker-settings-after.json >/dev/null
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/cp4-worker-settings-after.json >/tmp/cp4-secrets-after.json
cmp -s /tmp/cp4-secrets-before.json /tmp/cp4-secrets-after.json

jq -e --arg id "$STUDENTS" '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace" and .namespace_id==$id)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e --arg id "$LESSONS" '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace" and .namespace_id==$id)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e --arg id "$REBUILD_SHADOW_KV_NAMESPACE_ID" '.result.bindings[]|select(.name=="REBUILD_SHADOW_KV" and .type=="kv_namespace" and .namespace_id==$id)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e --arg id "$DBID" '.result.bindings[]|select(.name=="DB" and .type=="d1" and .id==$id)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e --arg id "$REBUILD_SHADOW_DB_ID" '.result.bindings[]|select(.name=="REBUILD_SHADOW_DB" and .type=="d1" and .id==$id)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e --arg name "$R2" '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket" and .bucket_name==$name)' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e '.result.bindings[]|select(.name=="EMAIL")' /tmp/cp4-worker-settings-after.json >/dev/null
jq -e '.result.bindings[]|select(.name=="CHECKPOINT4_SHADOW_MODE" and .type=="plain_text" and .text=="legacy-authoritative")' /tmp/cp4-worker-settings-after.json >/dev/null

echo 'CHECKPOINT4_PRODUCTION_BINDINGS_PRESERVED_AND_SHADOW_ADDED'
