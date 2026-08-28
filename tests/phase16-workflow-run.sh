#!/usr/bin/env bash
set -Eeuo pipefail

PHASE15_MAIN='e9f1085c6797d51a9a14b2d6b118a4fb94576f38'
FOUNDATION_PATH='.github/workflows/phase16-device-browser-resource-session-acceptance.yml'
: "${P16_PR_BASE_SHA:?missing PR base SHA}"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
P16_RUN_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
export P16_RUN_START
BACKUP_READY=0
STUDENTS=''
LESSONS=''

fail(){ echo "ERROR: $*" >&2; exit 1; }

restore_and_verify(){
  local original_status="$1" cleanup_status=0 user file
  set +e

  if [ "$BACKUP_READY" -eq 1 ] && [ -n "$STUDENTS" ]; then
    for user in testy5e testy5em; do
      file="/tmp/p16-original-${user}.json"
      if [ -s "$file" ]; then
        curl --fail --silent --show-error --request PUT \
          "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STUDENTS}/values/user%3A${user}" \
          --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
          --header 'Content-Type: application/json' --data-binary "@$file" >/dev/null || cleanup_status=1
      fi
    done
  fi

  ids="'testy2e','testy2m','testy2em','testy4em','testy411m','testy511e','testy5em','testy5e','testy511em'"
  sql="DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${P16_RUN_START}'); DELETE FROM answer_view_tokens WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${P16_RUN_START}'; DELETE FROM student_session_profiles WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${P16_RUN_START}'; DELETE FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${P16_RUN_START}'; DELETE FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'; DELETE FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'; DELETE FROM batch_definitions WHERE batch_key LIKE 'P16_%'; DELETE FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%';"
  $W d1 execute fpt_portal_v2_db --remote --json --command "$sql" >/tmp/p16-final-clean.json 2>/tmp/p16-final-clean.err || cleanup_status=1

  if [ "$BACKUP_READY" -eq 1 ] && [ -n "$STUDENTS" ]; then
    for user in testy5e testy5em; do
      curl --fail --silent --show-error \
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STUDENTS}/values/user%3A${user}" \
        --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "/tmp/p16-restored-${user}.json" || cleanup_status=1
      if [ -s "/tmp/p16-restored-${user}.json" ] && [ -s "/tmp/p16-original-${user}.json" ]; then
        diff -u <(jq -S . "/tmp/p16-original-${user}.json") <(jq -S . "/tmp/p16-restored-${user}.json") >/dev/null || cleanup_status=1
      else
        cleanup_status=1
      fi
    done
  fi

  $W d1 execute fpt_portal_v2_db --remote --json --command "SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS p16e FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%'; SELECT COUNT(*) AS p16b FROM batch_definitions WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16a FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16r FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS active_p16_sessions FROM student_sessions WHERE portal_user_id_norm LIKE 'testy%' AND created_at >= '${P16_RUN_START}' AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'); SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;" >/tmp/p16-baseline-final.json 2>/tmp/p16-baseline-final.err || cleanup_status=1

  if [ -s /tmp/p16-baseline-final.json ]; then
    test "$(jq -r '.[0].results[0].entitlement_count' /tmp/p16-baseline-final.json)" = '632' || cleanup_status=1
    test "$(jq -r '.[1].results[0].batch_count' /tmp/p16-baseline-final.json)" = '4' || cleanup_status=1
    test "$(jq -r '.[2].results[0].assignment_count' /tmp/p16-baseline-final.json)" = '4' || cleanup_status=1
    test "$(jq -r '.[3].results[0].release_count' /tmp/p16-baseline-final.json)" = '0' || cleanup_status=1
    test "$(jq -r '.[4].results[0].assigned_users' /tmp/p16-baseline-final.json)" = '2' || cleanup_status=1
    test "$(jq -r '.[5].results[0].assigned_user_entitlements' /tmp/p16-baseline-final.json)" = '173' || cleanup_status=1
    for i in 6 7 8 9 10; do test "$(jq -r ".[${i}].results[0] | to_entries[0].value" /tmp/p16-baseline-final.json)" = '0' || cleanup_status=1; done
    jq -e '.[11].results[0].name == "trg_student_sessions_single_active"' /tmp/p16-baseline-final.json >/dev/null || cleanup_status=1
    jq -e '.[12].results[0].quick_check == "ok"' /tmp/p16-baseline-final.json >/dev/null || cleanup_status=1
  fi

  curl --fail --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output /tmp/p16-settings-final.json || cleanup_status=1
  if [ -s /tmp/p16-settings-final.json ]; then
    jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' /tmp/p16-settings-final.json >/dev/null || cleanup_status=1
    test "$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' /tmp/p16-settings-final.json)" = 'fpt-materials-dev' || cleanup_status=1
    login="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' /tmp/p16-settings-final.json)"
    case "${login,,}" in ''|'false') ;; *) cleanup_status=1;; esac
  fi

  set -e
  if [ "$cleanup_status" -ne 0 ]; then
    echo 'ERROR: Phase 16 exact cleanup/final baseline verification failed.' >&2
    exit 97
  fi
  echo 'PHASE16_FINAL_EXACT_BASELINE_AND_ISOLATION_PASS'
  exit "$original_status"
}

on_exit(){
  status=$?
  trap - EXIT
  restore_and_verify "$status"
}
trap on_exit EXIT

# The Phase 16 workflow foundation is the only permitted repository change on
# main after the Phase 15 closure SHA before this Phase 16 PR begins testing.
git merge-base --is-ancestor "$PHASE15_MAIN" "$P16_PR_BASE_SHA" || fail 'PR base is not descended from the Phase 15 closure SHA.'
mapfile -t base_changes < <(git diff --name-only "$PHASE15_MAIN" "$P16_PR_BASE_SHA")
test "${#base_changes[@]}" -eq 1 || fail 'Unexpected repository changes exist on main after Phase 15 closure.'
test "${base_changes[0]}" = "$FOUNDATION_PATH" || fail 'Unexpected non-foundation change exists on main after Phase 15 closure.'
echo 'PHASE16_REPOSITORY_RECONCILIATION_PASS'

# Static/inherited gates are run before any Phase 16 mutation.
node --check tests/phase16-runtime.mjs
node --check tests/phase16-browser-resource-session.mjs
bash -n tests/phase16-workflow-run.sh
grep -Fq '369 lessons / 11 curricula' docs/data/phase16/DEVICE_BROWSER_RESOURCE_SESSION_MATRIX.md
grep -Fq '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663' docs/data/phase16/DEVICE_BROWSER_RESOURCE_SESSION_MATRIX.md
grep -Fq 'NOT CONFIRMED' docs/data/phase16/DEVICE_BROWSER_RESOURCE_SESSION_MATRIX.md
node tests/phase14-excel-sync-matrix-verification.mjs
node tests/phase13-excel-sync-verification.mjs
node tests/phase12-batch-aware-worker-verification.mjs
node tests/phase12-batch-schema-static-verification.mjs
node --experimental-default-type=module tests/phase11-catalogue-static-verification.mjs | tee /tmp/p16-catalogue-static.log
grep -Fq '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663' /tmp/p16-catalogue-static.log
node scripts/phase11-navigation-manifest.mjs | tee /tmp/p16-navigation-manifest.log
jq -e '.catalogueSha256 == "7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663" and .curricula == 11 and .lessons == 369' /tmp/p16-navigation-manifest.log >/dev/null
node tests/phase15-master-navigation-regression.mjs
node tests/phase11-session-efficiency-static-verification.mjs
node tests/phase11-answer-dedup-static-verification.mjs
node tests/phase11-answer-header-static-verification.mjs
node tests/phase11-screenpal-static-verification.mjs
node tests/phase11-vr-howto-top-level-static-verification.mjs
node --experimental-default-type=module tests/phase11-vr-howto-real-catalogue-static-verification.mjs
node tests/phase11-vr-solution-video-policy-static-verification.mjs
node --experimental-default-type=module tests/phase11-test-personas-static-verification.mjs
echo 'PHASE16_STATIC_AND_INHERITED_GATES_PASS'

# Read-only deployed Worker/binding and D1 preflight.
curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output /tmp/p16-settings-before.json
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' /tmp/p16-settings-before.json >/dev/null
test "$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' /tmp/p16-settings-before.json)" = 'fpt-materials-dev'
login="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' /tmp/p16-settings-before.json)"
case "${login,,}" in ''|'false') ;; *) fail 'Normal V2 student login is enabled.';; esac
STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' /tmp/p16-settings-before.json)"
LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' /tmp/p16-settings-before.json)"
test -n "$STUDENTS" && test "$STUDENTS" != null
test -n "$LESSONS" && test "$LESSONS" != null
export P16_STUDENTS_KV="$STUDENTS" P16_LESSONS_KV="$LESSONS"

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output /tmp/p16-namespaces.json
legacy="$(jq -r '[.result[]|select(.title=="FPT_LESSONS_TEST")|.id][0] // ""' /tmp/p16-namespaces.json)"
if [ -n "$legacy" ]; then test "$LESSONS" != "$legacy"; fi

$W d1 execute fpt_portal_v2_db --remote --json --command "SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS p16e FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%'; SELECT COUNT(*) AS p16b FROM batch_definitions WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16a FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16r FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;" >/tmp/p16-baseline-before.json 2>/tmp/p16-baseline-before.err
test "$(jq -r '.[0].results[0].entitlement_count' /tmp/p16-baseline-before.json)" = '632'
test "$(jq -r '.[1].results[0].batch_count' /tmp/p16-baseline-before.json)" = '4'
test "$(jq -r '.[2].results[0].assignment_count' /tmp/p16-baseline-before.json)" = '4'
test "$(jq -r '.[3].results[0].release_count' /tmp/p16-baseline-before.json)" = '0'
test "$(jq -r '.[4].results[0].assigned_users' /tmp/p16-baseline-before.json)" = '2'
test "$(jq -r '.[5].results[0].assigned_user_entitlements' /tmp/p16-baseline-before.json)" = '173'
for i in 6 7 8 9; do test "$(jq -r ".[${i}].results[0] | to_entries[0].value" /tmp/p16-baseline-before.json)" = '0'; done
jq -e '.[10].results[0].name == "trg_student_sessions_single_active"' /tmp/p16-baseline-before.json >/dev/null
jq -e '.[11].results[0].quick_check == "ok"' /tmp/p16-baseline-before.json >/dev/null
echo 'PHASE16_READONLY_PREFLIGHT_PASS'

# Workflow-level exact backups make KV restoration independent of Node/browser termination.
for user in testy5e testy5em; do
  curl --fail --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STUDENTS}/values/user%3A${user}" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "/tmp/p16-original-${user}.json"
  jq -e 'type=="object" and (.p|type=="string") and (.answerPassword|type=="string")' "/tmp/p16-original-${user}.json" >/dev/null
done
BACKUP_READY=1
echo 'PHASE16_CONTROLLED_KV_BACKUP_READY'

npm install --no-save --no-package-lock playwright@latest >/dev/null
npx playwright install --with-deps firefox webkit
google-chrome --version

node tests/phase16-browser-resource-session.mjs
