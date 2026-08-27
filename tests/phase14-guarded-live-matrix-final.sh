#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN:?missing FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
MUTATION_STARTED=0
STUDENTS=''
LESSONS=''
USERS=(testy5p14m testy5p14e testy5p1411e testy5p14full)
BATCHES=(P14_Y5M P14_Y5E P14_Y511E)

kv_value_url() {
  local namespace="$1" key="$2" encoded
  encoded="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$key")"
  printf 'https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s' \
    "$CLOUDFLARE_ACCOUNT_ID" "$namespace" "$encoded"
}

cleanup_d1() {
  local sql
  sql="DELETE FROM lesson_entitlements WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full'); DELETE FROM batch_lesson_releases WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); DELETE FROM student_batch_assignments WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full') AND batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); DELETE FROM batch_definitions WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E');"
  $W d1 execute fpt_portal_v2_db --remote --json --command "$sql" >/tmp/p14-final-clean-d1.json 2>/tmp/p14-final-clean-d1.err
}

cleanup_kv() {
  local user url
  for user in "${USERS[@]}"; do
    url="$(kv_value_url "$STUDENTS" "user:${user}")"
    curl --fail --silent --show-error --request DELETE "$url" \
      --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" >/dev/null
  done
}

cleanup() {
  local rc=0
  set +e
  if [ "$MUTATION_STARTED" -eq 1 ]; then
    cleanup_d1 || rc=1
    cleanup_kv || rc=1
  fi
  set -e
  return "$rc"
}

on_exit() {
  local status=$?
  trap - EXIT
  if ! cleanup; then
    echo 'ERROR: Phase 14 exact fixture cleanup failed.' >&2
    exit 97
  fi
  exit "$status"
}
trap on_exit EXIT

echo 'Phase 14 final backend matrix: read-only preflight.'

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --output /tmp/p14-final-settings.json
jq -e '.success == true' /tmp/p14-final-settings.json >/dev/null
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' /tmp/p14-final-settings.json >/dev/null
LOGIN="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' /tmp/p14-final-settings.json)"
case "${LOGIN,,}" in ''|'false') ;; *) echo 'Normal V2 student login is enabled; refusing Phase 14 fixture work.' >&2; false;; esac
STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' /tmp/p14-final-settings.json)"
LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' /tmp/p14-final-settings.json)"
R2="$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' /tmp/p14-final-settings.json)"
test -n "$STUDENTS" && test "$STUDENTS" != null
test -n "$LESSONS" && test "$LESSONS" != null
test "$R2" = 'fpt-materials-dev'

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --output /tmp/p14-final-kv-namespaces.json
LEGACY="$(jq -r '[.result[]|select(.title=="FPT_LESSONS_TEST")|.id][0] // ""' /tmp/p14-final-kv-namespaces.json)"
if [ -n "$LEGACY" ]; then test "$LESSONS" != "$LEGACY"; fi

$W secret list --name "$WORKER_NAME" --format json >/tmp/p14-final-secret-list.json
jq -e '.[] | select(.name == "EXCEL_SYNC_TOKEN")' /tmp/p14-final-secret-list.json >/dev/null
echo 'Dedicated Excel sync secret present; value not printed.'

$W d1 execute fpt_portal_v2_db --remote --json --command \
  "SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS temp_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full'); SELECT COUNT(*) AS temp_batches FROM batch_definitions WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT COUNT(*) AS temp_assignments FROM student_batch_assignments WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full') OR batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT COUNT(*) AS temp_releases FROM batch_lesson_releases WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;" \
  >/tmp/p14-final-before.json 2>/tmp/p14-final-before.err
test "$(jq -r '.[0].results[0].entitlement_count' /tmp/p14-final-before.json)" = '632'
test "$(jq -r '.[1].results[0].batch_count' /tmp/p14-final-before.json)" = '4'
test "$(jq -r '.[2].results[0].assignment_count' /tmp/p14-final-before.json)" = '4'
test "$(jq -r '.[3].results[0].release_count' /tmp/p14-final-before.json)" = '0'
test "$(jq -r '.[4].results[0].assigned_users' /tmp/p14-final-before.json)" = '2'
test "$(jq -r '.[5].results[0].assigned_user_entitlements' /tmp/p14-final-before.json)" = '173'
test "$(jq -r '.[6].results[0].temp_entitlements' /tmp/p14-final-before.json)" = '0'
test "$(jq -r '.[7].results[0].temp_batches' /tmp/p14-final-before.json)" = '0'
test "$(jq -r '.[8].results[0].temp_assignments' /tmp/p14-final-before.json)" = '0'
test "$(jq -r '.[9].results[0].temp_releases' /tmp/p14-final-before.json)" = '0'
jq -e '.[10].results[0].name == "trg_student_sessions_single_active"' /tmp/p14-final-before.json >/dev/null
jq -e '.[11].results[0].quick_check == "ok"' /tmp/p14-final-before.json >/dev/null

PREFIX="$(node -e 'process.stdout.write(encodeURIComponent("user:testy5p14"))')"
curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STUDENTS}/keys?prefix=${PREFIX}&limit=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --output /tmp/p14-final-temp-kv-before.json
jq -e '.success == true and (.result|length) == 0' /tmp/p14-final-temp-kv-before.json >/dev/null

for lesson in Y5M1 Y5E10; do
  url="$(kv_value_url "$LESSONS" "lesson:${lesson}")"
  curl --fail --silent --show-error "$url" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    --output "/tmp/p14-final-${lesson}.json"
done
jq -e '.lessonId == "Y5M1" and .subject == "maths" and .active != false' /tmp/p14-final-Y5M1.json >/dev/null
jq -e '.lessonId == "Y5E10" and .subject == "english" and .active != false' /tmp/p14-final-Y5E10.json >/dev/null

echo 'Preflight passed; exact temporary fixtures are absent.'
MUTATION_STARTED=1

cat >/tmp/p14-final-user-m.json <<'JSON'
{"firstName":"TestY5P14M","schoolYear":5,"vrEligible":false,"status":"active","expires":null,"batches":["P14_Y5M"],"fullLibraries":[],"manualAccess":{"coreLessons":[],"vrLessons":[],"specialBuckets":[]},"blockedLessons":[]}
JSON
cat >/tmp/p14-final-user-e.json <<'JSON'
{"firstName":"TestY5P14E","schoolYear":5,"vrEligible":false,"status":"active","expires":null,"batches":["P14_Y5E"],"fullLibraries":[],"manualAccess":{"coreLessons":[],"vrLessons":[],"specialBuckets":[]},"blockedLessons":[]}
JSON
cat >/tmp/p14-final-user-11e.json <<'JSON'
{"firstName":"TestY5P1411E","schoolYear":5,"vrEligible":true,"status":"active","expires":null,"batches":["P14_Y511E"],"fullLibraries":[],"manualAccess":{"coreLessons":[],"vrLessons":[],"specialBuckets":[]},"blockedLessons":[]}
JSON
cat >/tmp/p14-final-user-full.json <<'JSON'
{"firstName":"TestY5P14FULL","schoolYear":5,"vrEligible":false,"status":"active","expires":null,"batches":["P14_Y5M"],"fullLibraries":["MATHS_L2_FULL"],"manualAccess":{"coreLessons":[],"vrLessons":[],"specialBuckets":[]},"blockedLessons":[]}
JSON

declare -A USER_FILES=(
  [testy5p14m]=/tmp/p14-final-user-m.json
  [testy5p14e]=/tmp/p14-final-user-e.json
  [testy5p1411e]=/tmp/p14-final-user-11e.json
  [testy5p14full]=/tmp/p14-final-user-full.json
)
for user in "${USERS[@]}"; do
  curl --fail --silent --show-error --request PUT "$(kv_value_url "$STUDENTS" "user:${user}")" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data-binary "@${USER_FILES[$user]}" >/dev/null
done

NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
SEED_SQL="INSERT INTO batch_definitions (batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to,created_at,updated_at) VALUES ('P14_Y5M','2026-27','maths',5,'normal',NULL,'2026-09-01',NULL,'${NOW}','${NOW}'),('P14_Y5E','2026-27','english',5,'normal',NULL,'2026-09-01',NULL,'${NOW}','${NOW}'),('P14_Y511E','2026-27','english',5,'11plus',NULL,'2026-09-01',NULL,'${NOW}','${NOW}'); INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5p14m','P14_Y5M','2026-09-15',NULL,'${NOW}','${NOW}'),('testy5p14e','P14_Y5E','2026-09-15',NULL,'${NOW}','${NOW}'),('testy5p1411e','P14_Y511E','2026-09-15',NULL,'${NOW}','${NOW}'),('testy5p14full','P14_Y5M','2026-09-15',NULL,'${NOW}','${NOW}');"
$W d1 execute fpt_portal_v2_db --remote --json --command "$SEED_SQL" >/tmp/p14-final-seed.json 2>/tmp/p14-final-seed.err

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}" \
  --header 'Content-Type: application/json' --request POST \
  --data '{"items":[{"syncRowId":"p14-full-precheck","operation":"status_check","portalUserId":"TestY5P14FULL","lessonId":"Y5M1","batchKey":"P14_Y5M","lessonDate":"2026-09-15"}]}' \
  "$WORKER_BASE/api/v1/admin/excel-entitlements/sync" >/tmp/p14-final-full-precheck.json
jq -e '.ok == true and .results[0].status == "ENTITLEMENT_MISSING" and .results[0].ok == false' /tmp/p14-final-full-precheck.json >/dev/null

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}" \
  --header 'Content-Type: application/json' --request POST \
  --data '{"items":[{"syncRowId":"p14-maths","operation":"grant","portalUserId":"TestY5P14M","lessonId":"Y5M1","batchKey":"P14_Y5M","lessonDate":"2026-09-15"},{"syncRowId":"p14-english","operation":"grant","portalUserId":"TestY5P14E","lessonId":"Y5E10","batchKey":"P14_Y5E","lessonDate":"2026-09-15"},{"syncRowId":"p14-english-vr","operation":"grant","portalUserId":"TestY5P1411E","lessonId":"Y5E10","batchKey":"P14_Y511E","lessonDate":"2026-09-15"},{"syncRowId":"p14-full","operation":"grant","portalUserId":"TestY5P14FULL","lessonId":"Y5M1","batchKey":"P14_Y5M","lessonDate":"2026-09-15"},{"syncRowId":"p14-invalid","operation":"grant","portalUserId":"TestY5P14E","lessonId":"__P14_MISSING__","batchKey":"P14_Y5E","lessonDate":"2026-09-15"}]}' \
  "$WORKER_BASE/api/v1/admin/excel-entitlements/sync" >/tmp/p14-final-live.json
jq -e '.ok == true and (.results|length)==5 and .summary.succeeded==4 and .summary.failed==1' /tmp/p14-final-live.json >/dev/null
jq -e '[.results[].status] == ["CREATED","CREATED","CREATED","CREATED","LESSON_NOT_FOUND"]' /tmp/p14-final-live.json >/dev/null

$W d1 execute fpt_portal_v2_db --remote --json --command \
  "SELECT COUNT(*) AS temp_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full'); SELECT COUNT(*) AS temp_releases FROM batch_lesson_releases WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT portal_user_id_norm,lesson_id,core_access,vr_access FROM lesson_entitlements WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full') ORDER BY portal_user_id_norm;" \
  >/tmp/p14-final-live-d1.json 2>/tmp/p14-final-live-d1.err
test "$(jq -r '.[0].results[0].temp_entitlements' /tmp/p14-final-live-d1.json)" = '4'
test "$(jq -r '.[1].results[0].temp_releases' /tmp/p14-final-live-d1.json)" = '3'
jq -e '.[2].results | length == 4' /tmp/p14-final-live-d1.json >/dev/null
jq -e '.[2].results[] | select(.portal_user_id_norm=="testy5p14m") | .lesson_id=="Y5M1" and .core_access==1 and .vr_access==0' /tmp/p14-final-live-d1.json >/dev/null
jq -e '.[2].results[] | select(.portal_user_id_norm=="testy5p14e") | .lesson_id=="Y5E10" and .core_access==1 and .vr_access==0' /tmp/p14-final-live-d1.json >/dev/null
jq -e '.[2].results[] | select(.portal_user_id_norm=="testy5p1411e") | .lesson_id=="Y5E10" and .core_access==1 and .vr_access==1' /tmp/p14-final-live-d1.json >/dev/null
jq -e '.[2].results[] | select(.portal_user_id_norm=="testy5p14full") | .lesson_id=="Y5M1" and .core_access==1 and .vr_access==0' /tmp/p14-final-live-d1.json >/dev/null

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}" \
  --header 'Content-Type: application/json' --request POST \
  --data '{"items":[{"syncRowId":"p14-full-repeat","operation":"grant","portalUserId":"TestY5P14FULL","lessonId":"Y5M1","batchKey":"P14_Y5M","lessonDate":"2026-09-15"}]}' \
  "$WORKER_BASE/api/v1/admin/excel-entitlements/sync" >/tmp/p14-final-repeat.json
jq -e '.results[0].status == "CONFIRMED" and .results[0].entitlement == "confirmed" and .results[0].batchRelease == "confirmed"' /tmp/p14-final-repeat.json >/dev/null

echo 'Live outcome matrix passed; cleaning exact Phase 14 fixtures.'
cleanup
MUTATION_STARTED=0

$W d1 execute fpt_portal_v2_db --remote --json --command \
  "SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS temp_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full'); SELECT COUNT(*) AS temp_batches FROM batch_definitions WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT COUNT(*) AS temp_assignments FROM student_batch_assignments WHERE portal_user_id_norm IN ('testy5p14m','testy5p14e','testy5p1411e','testy5p14full') OR batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT COUNT(*) AS temp_releases FROM batch_lesson_releases WHERE batch_key IN ('P14_Y5M','P14_Y5E','P14_Y511E'); SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;" \
  >/tmp/p14-final-after.json 2>/tmp/p14-final-after.err
test "$(jq -r '.[0].results[0].entitlement_count' /tmp/p14-final-after.json)" = '632'
test "$(jq -r '.[1].results[0].batch_count' /tmp/p14-final-after.json)" = '4'
test "$(jq -r '.[2].results[0].assignment_count' /tmp/p14-final-after.json)" = '4'
test "$(jq -r '.[3].results[0].release_count' /tmp/p14-final-after.json)" = '0'
test "$(jq -r '.[4].results[0].assigned_users' /tmp/p14-final-after.json)" = '2'
test "$(jq -r '.[5].results[0].assigned_user_entitlements' /tmp/p14-final-after.json)" = '173'
test "$(jq -r '.[6].results[0].temp_entitlements' /tmp/p14-final-after.json)" = '0'
test "$(jq -r '.[7].results[0].temp_batches' /tmp/p14-final-after.json)" = '0'
test "$(jq -r '.[8].results[0].temp_assignments' /tmp/p14-final-after.json)" = '0'
test "$(jq -r '.[9].results[0].temp_releases' /tmp/p14-final-after.json)" = '0'
jq -e '.[10].results[0].name == "trg_student_sessions_single_active"' /tmp/p14-final-after.json >/dev/null
jq -e '.[11].results[0].quick_check == "ok"' /tmp/p14-final-after.json >/dev/null

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STUDENTS}/keys?prefix=${PREFIX}&limit=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --output /tmp/p14-final-temp-kv-after.json
jq -e '.success == true and (.result|length) == 0' /tmp/p14-final-temp-kv-after.json >/dev/null

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --output /tmp/p14-final-settings-after.json
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' /tmp/p14-final-settings-after.json >/dev/null
test "$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' /tmp/p14-final-settings-after.json)" = 'fpt-materials-dev'
AFTER_LOGIN="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' /tmp/p14-final-settings-after.json)"
case "${AFTER_LOGIN,,}" in ''|'false') ;; *) false;; esac

trap - EXIT
echo 'Phase 14 final guarded live backend matrix: PASS; exact documented D1/KV baseline restored.'
