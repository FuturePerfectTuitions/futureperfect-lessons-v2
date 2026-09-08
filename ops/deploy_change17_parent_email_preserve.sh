#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${PARENT_EMAIL_TEST_TO:?Parent email deployment requires a safe test recipient}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WRANGLER_VERSION:=4.125.0}"
: "${WORKER_CONFIG_FILE:=worker/wrangler.toml}"

CONFIG_DIR="$(dirname "$WORKER_CONFIG_FILE")"
CONFIG_ENTRYPOINT="$(sed -nE 's/^main[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$WORKER_CONFIG_FILE" | head -n 1)"
WORKER_ENTRYPOINT="${WORKER_ENTRYPOINT:-$CONFIG_ENTRYPOINT}"
test -n "$WORKER_ENTRYPOINT"
test -f "$CONFIG_DIR/$WORKER_ENTRYPOINT"
test "$WORKER_ENTRYPOINT" = 'src/index-phase20-change20-configured-upsell.js'
echo "Current production Worker entrypoint: $WORKER_ENTRYPOINT"

rm -rf /tmp/fpt-change17-navigation-package
node --experimental-default-type=module scripts/phase11-apply-package.mjs \
  --write-dir /tmp/fpt-change17-navigation-package \
  >/tmp/fpt-change17-navigation-package.log
MANIFEST='worker/src/phase11-navigation-manifest.generated.js'
grep -Fq 'Generated from the immutable Phase 11 canonical catalogue.' "$MANIFEST"
grep -Fq 'Navigation manifest SHA-256: d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083' "$MANIFEST"
grep -Fq 'const PHASE11_NAVIGATION_MANIFEST = {' "$MANIFEST"
jq -e '.navigationManifestLessons == 369 and .navigationManifestCurricula == 11 and .navigationManifestSha256 == "d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083"' \
  /tmp/fpt-change17-navigation-package/phase11-apply-summary.json >/dev/null

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/fpt-change17-settings-before.json
jq -e '.success == true' /tmp/fpt-change17-settings-before.json >/dev/null
plain(){ jq -r --arg n "$1" '[.result.bindings[]|select(.name==$n and .type=="plain_text")|.text][0] // ""' /tmp/fpt-change17-settings-before.json; }
field(){ jq -r --arg n "$1" --arg t "$2" --arg f "$3" '[.result.bindings[]|select(.name==$n and .type==$t)|.[$f]][0] // ""' /tmp/fpt-change17-settings-before.json; }
STUDENTS="$(field STUDENTS_KV kv_namespace namespace_id)"
LESSONS="$(field LESSONS_KV kv_namespace namespace_id)"
DBID="$(field DB d1 id)"
R2="$(field MATERIALS_R2 r2_bucket bucket_name)"
for value in "$STUDENTS" "$LESSONS" "$DBID" "$R2"; do test -n "$value"; done
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-change17-settings-before.json >/tmp/fpt-change17-secrets-before.json

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
  printf '\n[[send_email]]\nname = "EMAIL"\n'
  printf '\n[[kv_namespaces]]\nbinding = "STUDENTS_KV"\nid = "%s"\n' "$STUDENTS"
  printf '\n[[kv_namespaces]]\nbinding = "LESSONS_KV"\nid = "%s"\n' "$LESSONS"
  printf '\n[[r2_buckets]]\nbinding = "MATERIALS_R2"\nbucket_name = "%s"\n' "$R2"
  printf '\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fpt_portal_v2_db"\ndatabase_id = "%s"\n' "$DBID"
} > worker/wrangler.change17.runtime.toml

grep -Fq 'main = "src/index-phase20-change20-configured-upsell.js"' worker/wrangler.change17.runtime.toml
grep -Fq 'PARENT_EMAIL_TEST_TO = "'"$PARENT_EMAIL_TEST_TO"'"' worker/wrangler.change17.runtime.toml
grep -Fq '[[send_email]]' worker/wrangler.change17.runtime.toml
grep -Fq 'name = "EMAIL"' worker/wrangler.change17.runtime.toml

npx --yes wrangler@"$WRANGLER_VERSION" deploy \
  --config worker/wrangler.change17.runtime.toml \
  --keep-vars \
  --message "${DEPLOY_MESSAGE:-Portal V2 parent email test mode on current production wrapper}"

curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/fpt-change17-settings-after.json
jq -e '.success == true' /tmp/fpt-change17-settings-after.json >/dev/null
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-change17-settings-after.json >/tmp/fpt-change17-secrets-after.json
cmp -s /tmp/fpt-change17-secrets-before.json /tmp/fpt-change17-secrets-after.json
jq -e '.result.bindings[] | select(.name=="EMAIL")' /tmp/fpt-change17-settings-after.json >/dev/null
jq -e --arg expected "$PARENT_EMAIL_TEST_TO" '.result.bindings[] | select(.name=="PARENT_EMAIL_TEST_TO" and .type=="plain_text" and .text==$expected)' /tmp/fpt-change17-settings-after.json >/dev/null
echo 'PARENT_EMAIL_DEPLOYED_IN_TEST_MODE_ON_CURRENT_WRAPPER'
