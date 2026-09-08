#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WRANGLER_VERSION:=4.125.0}"
: "${WORKER_CONFIG_FILE:=worker/wrangler.toml}"

CONFIG_DIR="$(dirname "$WORKER_CONFIG_FILE")"
CONFIG_ENTRYPOINT="$(sed -nE 's/^main[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$WORKER_CONFIG_FILE" | head -n 1)"
WORKER_ENTRYPOINT="${WORKER_ENTRYPOINT:-$CONFIG_ENTRYPOINT}"
test -n "$WORKER_ENTRYPOINT"
test -f "$CONFIG_DIR/$WORKER_ENTRYPOINT"
echo "Production Worker entrypoint: $WORKER_ENTRYPOINT"

# The checked-in navigation manifest is deliberately only a fail-safe placeholder.
# Every production Worker bundle that imports Phase 11 navigation must regenerate the
# immutable canonical navigation manifest before Wrangler bundles the entrypoint.
# Without this step, canonicalCatalogueRowsForView() has no bundled catalogue and
# entitlement-backed L1/L2 lesson-list recovery cannot build the requested list.
rm -rf /tmp/fpt-navigation-package
node --experimental-default-type=module scripts/phase11-apply-package.mjs \
  --write-dir /tmp/fpt-navigation-package \
  >/tmp/fpt-navigation-package.log
MANIFEST='worker/src/phase11-navigation-manifest.generated.js'
grep -Fq 'Generated from the immutable Phase 11 canonical catalogue.' "$MANIFEST"
grep -Fq 'Navigation manifest SHA-256: d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083' "$MANIFEST"
grep -Fq 'const PHASE11_NAVIGATION_MANIFEST = {' "$MANIFEST"
jq -e '.navigationManifestLessons == 369 and .navigationManifestCurricula == 11 and .navigationManifestSha256 == "d82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083"' \
  /tmp/fpt-navigation-package/phase11-apply-summary.json >/dev/null
echo 'Canonical bundled navigation manifest generated for production bundle.'

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
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-secrets-before.json >/dev/null 2>&1 || true
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-worker-settings.json >/tmp/fpt-secrets-before.json
{
  printf 'name = "%s"\n' "$WORKER_NAME"
  printf 'main = "%s"\n' "$WORKER_ENTRYPOINT"
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

grep -Fq "main = \"$WORKER_ENTRYPOINT\"" worker/wrangler.runtime-preserve.toml
npx --yes wrangler@"$WRANGLER_VERSION" deploy --config worker/wrangler.runtime-preserve.toml --keep-vars --message "${DEPLOY_MESSAGE:-Portal V2 production update}"
curl --fail --silent --show-error "$API/workers/scripts/${WORKER_NAME}/settings" -H "$AUTH" -o /tmp/fpt-worker-settings-after.json
jq -c '[.result.bindings[]|select((.type//"")|test("secret";"i"))|.name]|sort' /tmp/fpt-worker-settings-after.json >/tmp/fpt-secrets-after.json
cmp -s /tmp/fpt-secrets-before.json /tmp/fpt-secrets-after.json
