#!/usr/bin/env bash
set -Eeuo pipefail

PHASE15_MAIN='e9f1085c6797d51a9a14b2d6b118a4fb94576f38'
FOUNDATION_PATH='.github/workflows/phase16-device-browser-resource-session-acceptance.yml'
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
P16_RUN_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
export P16_RUN_START
BACKUP_READY=0
MUTATION_ARMED=0
STUDENTS=''
LESSONS=''

fail(){ echo "ERROR: $*" >&2; exit 1; }

verify_baseline(){
  local label="$1"
  $W d1 execute fpt_portal_v2_db --remote --json --command "SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS p16e FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%'; SELECT COUNT(*) AS p16b FROM batch_definitions WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16a FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS p16r FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;" >"/tmp/p16-${label}-baseline.json" 2>"/tmp/p16-${label}-baseline.err"
  local f="/tmp/p16-${label}-baseline.json"
  test "$(jq -r '.[0].results[0].entitlement_count' "$f")" = '632'
  test "$(jq -r '.[1].results[0].batch_count' "$f")" = '4'
  test "$(jq -r '.[2].results[0].assignment_count' "$f")" = '4'
  test "$(jq -r '.[3].results[0].release_count' "$f")" = '0'
  test "$(jq -r '.[4].results[0].assigned_users' "$f")" = '2'
  test "$(jq -r '.[5].results[0].assigned_user_entitlements' "$f")" = '173'
  for i in 6 7 8 9; do test "$(jq -r ".[${i}].results[0] | to_entries[0].value" "$f")" = '0'; done
  jq -e '.[10].results[0].name == "trg_student_sessions_single_active"' "$f" >/dev/null
  jq -e '.[11].results[0].quick_check == "ok"' "$f" >/dev/null
}

verify_worker_safety(){
  local label="$1"
  local f="/tmp/p16-${label}-settings.json"
  curl --fail --silent --show-error \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$f"
  jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' "$f" >/dev/null
  test "$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' "$f")" = 'fpt-materials-dev'
  local login
  login="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' "$f")"
  case "${login,,}" in ''|'false') ;; *) fail 'Normal V2 student login is enabled.';; esac
  STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' "$f")"
  LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' "$f")"
  test -n "$STUDENTS" && test "$STUDENTS" != null
  test -n "$LESSONS" && test "$LESSONS" != null
}

restore_and_verify(){
  local original_status="$1" cleanup_status=0 user file ids sql login
  set +e

  if [ "$MUTATION_ARMED" -eq 1 ]; then
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
  fi

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

  verify_baseline final || cleanup_status=1
  verify_worker_safety final || cleanup_status=1

  if [ "$MUTATION_ARMED" -eq 1 ]; then
    $W d1 execute fpt_portal_v2_db --remote --json --command "SELECT COUNT(*) AS active_p16_sessions FROM student_sessions WHERE portal_user_id_norm LIKE 'testy%' AND created_at >= '${P16_RUN_START}' AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');" >/tmp/p16-final-sessions.json 2>/tmp/p16-final-sessions.err || cleanup_status=1
    test "$(jq -r '.[0].results[0].active_p16_sessions' /tmp/p16-final-sessions.json 2>/dev/null)" = '0' || cleanup_status=1
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

# Reconcile against the actual current main ref fetched by checkout. GitHub's
# pull_request.base.sha can remain the PR creation base after main advances, so
# it is not used as proof of the live repository state.
CURRENT_MAIN="$(git rev-parse origin/main)"
git merge-base --is-ancestor "$PHASE15_MAIN" "$CURRENT_MAIN" || fail 'Current main is not descended from the Phase 15 closure SHA.'
mapfile -t base_changes < <(git diff --name-only "$PHASE15_MAIN" "$CURRENT_MAIN")
test "${#base_changes[@]}" -eq 1 || fail 'Unexpected repository changes exist on current main after Phase 15 closure.'
test "${base_changes[0]}" = "$FOUNDATION_PATH" || fail 'Unexpected non-foundation change exists on current main after Phase 15 closure.'
echo "PHASE16_REPOSITORY_RECONCILIATION_PASS current_main=${CURRENT_MAIN}"

# Static/inherited gates are read-only and run before any Phase 16 mutation.
node --check tests/phase16-runtime.mjs
node --check tests/phase16-browser-resource-session.mjs
node --check tests/phase16-browser-resource-session-runner.mjs
node --check tests/phase16-session-transport-static-verification.mjs
node --check tests/phase16-ui-refinement-static-verification.mjs
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
! grep -Fq 'const PHASE11_NAVIGATION_MANIFEST = null;' worker/src/phase11-navigation-manifest.generated.js
node tests/phase16-session-transport-static-verification.mjs
node tests/phase16-ui-refinement-static-verification.mjs
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

# Fresh read-only deployed Worker/binding and D1 baseline inspection.
verify_worker_safety before
export P16_STUDENTS_KV="$STUDENTS" P16_LESSONS_KV="$LESSONS"
curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output /tmp/p16-namespaces.json
legacy="$(jq -r '[.result[]|select(.title=="FPT_LESSONS_TEST")|.id][0] // ""' /tmp/p16-namespaces.json)"
if [ -n "$legacy" ]; then test "$LESSONS" != "$legacy"; fi
verify_baseline before
echo 'PHASE16_READONLY_PREFLIGHT_PASS'

# Exact workflow-level backups for the only controlled TestY KV records the
# browser harness is permitted to modify.
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

# Only now are development-only controlled mutations authorised.
MUTATION_ARMED=1
node tests/phase16-browser-resource-session-runner.mjs