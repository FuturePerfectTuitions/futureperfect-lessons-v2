#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
ORIGIN='https://futureperfecttuitions.github.io'
TMP="$(mktemp -d)"
TEST_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
DUMMY="__phase17final_${GITHUB_RUN_ID:-local}"
STUDENTS=''; LESSONS=''; DB=''; R2=''; ORIGINS=''; Y3=''; Y5=''
ALLOWLIST_CHANGED=0
DUMMY_CREATED=0

fail(){ echo "ERROR: $*" >&2; exit 1; }
mask(){ [ -z "${1:-}" ] || echo "::add-mask::$1"; }
urlenc(){ node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

cf_get(){
  curl --fail --silent --show-error "$1" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$2"
}
kv_value_url(){ printf 'https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s' "$CLOUDFLARE_ACCOUNT_ID" "$1" "$(urlenc "$2")"; }
kv_get(){ curl --fail --silent --show-error "$(kv_value_url "$1" "$2")" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$3"; }
kv_put(){ curl --fail --silent --show-error --request PUT "$(kv_value_url "$1" "$2")" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --header 'Content-Type: application/json' --data-binary "@$3" >/dev/null; }
kv_delete(){ curl --fail --silent --show-error --request DELETE "$(kv_value_url "$1" "$2")" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" >/dev/null; }

d1(){
  local sql="$1" out="$2"
  $W d1 execute fpt_portal_v2_db --remote --json --command "$sql" >"$out" 2>"$out.err"
}

api_get(){
  local jar="$1" path="$2" out="$3"
  curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' "$WORKER_BASE$path" >"$out"
}
api_post(){
  local jar="$1" path="$2" body="$3" out="$4"
  curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' --header 'Content-Type: application/json' --request POST --data "$body" "$WORKER_BASE$path" >"$out"
}
api_code_get(){
  local jar="$1" path="$2" out="$3"
  curl --silent --show-error --output "$out" --write-out '%{http_code}' --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' "$WORKER_BASE$path"
}
api_code_post(){
  local jar="$1" path="$2" body="$3" out="$4"
  curl --silent --show-error --output "$out" --write-out '%{http_code}' --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' --header 'Content-Type: application/json' --request POST --data "$body" "$WORKER_BASE$path"
}

runtime_config(){
  local allow="$1"
  cat > "$TMP/wrangler.runtime.toml" <<EOF
name = "fpt-portal-v2-worker"
main = "worker/src/index-phase17.js"
compatibility_date = "2026-08-20"
keep_vars = true
workers_dev = true
[vars]
ENVIRONMENT = "development"
ALLOWED_ORIGINS = "${ORIGINS}"
STUDENT_LOGIN_ENABLED = "false"
DEV_LOGIN_ALLOWLIST = "${allow}"
[[kv_namespaces]]
binding = "STUDENTS_KV"
id = "${STUDENTS}"
[[kv_namespaces]]
binding = "LESSONS_KV"
id = "${LESSONS}"
[[r2_buckets]]
binding = "MATERIALS_R2"
bucket_name = "${R2}"
[[d1_databases]]
binding = "DB"
database_name = "fpt_portal_v2_db"
database_id = "${DB}"
EOF
}

deploy_allowlist(){
  runtime_config "$1"
  $W deploy --config "$TMP/wrangler.runtime.toml" --keep-vars --message 'Phase 17 guarded selected-real acceptance' >"$TMP/deploy.log" 2>&1
  sleep 4
}

login_from_file(){
  local user="$1" file="$2" jar="$3" out="$4" password payload
  password="$(jq -r '.p // empty' "$file")"; [ -n "$password" ] || fail 'selected record lacks login credential'
  mask "$password"
  payload="$(jq -cn --arg username "$user" --arg password "$password" '{username:$username,password:$password}')"
  api_post "$jar" '/api/v1/student/auth/login' "$payload" "$out"
  jq -e '.ok==true' "$out" >/dev/null
}

cleanup(){
  local rc=0 ids
  set +e
  ids=''
  for id in "$Y3" "$Y5" "$DUMMY"; do
    [ -n "$id" ] || continue
    safe="$(printf '%s' "$id" | sed "s/'/''/g")"
    ids="${ids}${ids:+,}'${safe}'"
  done
  if [ -n "$ids" ] && [ -n "$DB" ]; then
    d1 "DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'); DELETE FROM answer_view_tokens WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'; DELETE FROM student_session_profiles WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'; DELETE FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}';" "$TMP/cleanup-d1.json" || rc=1
  fi
  if [ "$DUMMY_CREATED" -eq 1 ] && [ -n "$STUDENTS" ]; then kv_delete "$STUDENTS" "user:$DUMMY" || rc=1; fi
  if [ "$ALLOWLIST_CHANGED" -eq 1 ] && [ -n "$STUDENTS" ] && [ -n "$LESSONS" ] && [ -n "$DB" ] && [ -n "$R2" ]; then deploy_allowlist '' || rc=1; fi
  rm -rf "$TMP"
  set -e
  return "$rc"
}

on_exit(){
  local status=$?
  trap - EXIT
  if ! cleanup; then echo 'ERROR: Phase 17 live-acceptance cleanup failed.' >&2; exit 97; fi
  exit "$status"
}
trap on_exit EXIT

SETTINGS_URL="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings"
cf_get "$SETTINGS_URL" "$TMP/settings-before.json"
jq -e '.success==true' "$TMP/settings-before.json" >/dev/null
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' "$TMP/settings-before.json" >/dev/null
LOGIN="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' "$TMP/settings-before.json")"
case "${LOGIN,,}" in ''|'false') ;; *) fail 'normal student login is enabled';; esac
BEFORE_ALLOW="$(jq -r '[.result.bindings[]|select(.name=="DEV_LOGIN_ALLOWLIST" and .type=="plain_text")|.text][0] // ""' "$TMP/settings-before.json")"
test -z "$BEFORE_ALLOW" || fail 'development login allowlist is not empty at preflight'
STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings-before.json")"
LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings-before.json")"
DB="$(jq -r '.result.bindings[]|select(.name=="DB" and .type=="d1")|.id' "$TMP/settings-before.json")"
R2="$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' "$TMP/settings-before.json")"
ORIGINS="$(jq -r '[.result.bindings[]|select(.name=="ALLOWED_ORIGINS" and .type=="plain_text")|.text][0] // "https://futureperfecttuitions.github.io"' "$TMP/settings-before.json")"
test -n "$STUDENTS" && test -n "$LESSONS" && test -n "$DB"; test "$R2" = 'fpt-materials-dev'
jq -r '.result.bindings[]|select(.type=="secret_text")|.name' "$TMP/settings-before.json" | sort > "$TMP/secrets-before.txt"
grep -Fxq EXCEL_SYNC_TOKEN "$TMP/secrets-before.txt"

# Resolve the two production-intended records only by their authoritative batch pairing.
d1 "SELECT portal_user_id_norm,batch_key FROM student_batch_assignments ORDER BY portal_user_id_norm,batch_key;" "$TMP/assignments.json"
Y3="$(jq -r '.[0].results | group_by(.portal_user_id_norm)[] | select(([.[].batch_key]|sort)==["Y3FE","Y3FM"]) | .[0].portal_user_id_norm' "$TMP/assignments.json")"
Y5="$(jq -r '.[0].results | group_by(.portal_user_id_norm)[] | select(([.[].batch_key]|sort)==["Y511FE","Y511FM"]) | .[0].portal_user_id_norm' "$TMP/assignments.json")"
test -n "$Y3" && test -n "$Y5" && test "$Y3" != "$Y5"
mask "$Y3"; mask "$Y5"; mask "$DUMMY"
kv_get "$STUDENTS" "user:$Y3" "$TMP/y3.json"
kv_get "$STUDENTS" "user:$Y5" "$TMP/y5.json"
jq -e '.schoolYear==3 and .vrEligible!=true and .status=="active" and (.fullLibraries//[])==[] and (.manualAccess.coreLessons//[])==[] and (.manualAccess.vrLessons//[])==[] and (.manualAccess.specialBuckets//[])==[] and (.blockedLessons//[])==[]' "$TMP/y3.json" >/dev/null
jq -e '.schoolYear==5 and .vrEligible==true and .status=="active" and (.fullLibraries//[])==[] and (.manualAccess.coreLessons//[])==[] and (.manualAccess.vrLessons//[])==[] and (.manualAccess.specialBuckets//[])==[] and (.blockedLessons//[])==[]' "$TMP/y5.json" >/dev/null
for f in "$TMP/y3.json" "$TMP/y5.json"; do
  jq -e '(.p|type=="string" and length==4 and test("[A-Z]") and test("[a-z]") and test("[0-9]")) and (.answerPassword|type=="string" and length==4 and test("[A-Z]") and test("[a-z]") and test("[0-9]"))' "$f" >/dev/null
done

DUMMY_P=''; DUMMY_A=''
DUMMY_P="$(node -e 'const c=require("node:crypto");process.stdout.write("Pq"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"
DUMMY_A="$(node -e 'const c=require("node:crypto");process.stdout.write("Az"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"
mask "$DUMMY_P"; mask "$DUMMY_A"
jq -cn --arg p "$DUMMY_P" --arg a "$DUMMY_A" '{firstName:"Phase17",p:$p,answerPassword:$a,schoolYear:5,vrEligible:true,status:"active",expires:null,batches:["Y5M11DEV1","Y5E11DEV1"],fullLibraries:[],manualAccess:{coreLessons:[],vrLessons:[],specialBuckets:["VR_HOWTO"]},blockedLessons:[]}' > "$TMP/dummy.json"
kv_put "$STUDENTS" "user:$DUMMY" "$TMP/dummy.json"; DUMMY_CREATED=1
for attempt in $(seq 1 15); do
  if kv_get "$STUDENTS" "user:$DUMMY" "$TMP/dummy-read.json" 2>/dev/null && jq -e '.manualAccess.specialBuckets==["VR_HOWTO"]' "$TMP/dummy-read.json" >/dev/null; then break; fi
  sleep 2
done
jq -e '.manualAccess.specialBuckets==["VR_HOWTO"]' "$TMP/dummy-read.json" >/dev/null

# Temporarily allow exactly the two selected real records plus the controlled dummy. Normal login stays false.
deploy_allowlist "${Y3},${Y5},${DUMMY}"; ALLOWLIST_CHANGED=1
cf_get "$SETTINGS_URL" "$TMP/settings-allowed.json"
jq -e '.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text" and .text=="false")' "$TMP/settings-allowed.json" >/dev/null
CURRENT_ALLOW="$(jq -r '.result.bindings[]|select(.name=="DEV_LOGIN_ALLOWLIST" and .type=="plain_text")|.text' "$TMP/settings-allowed.json")"
test "$CURRENT_ALLOW" = "${Y3},${Y5},${DUMMY}"

FAKE_CODE="$(api_code_post "$TMP/fake.jar" '/api/v1/student/auth/login' '{"username":"__phase17_not_allowed__","password":"Aa1x"}' "$TMP/fake.json")"
test "$FAKE_CODE" = '401'; jq -e '.error=="INVALID_LOGIN"' "$TMP/fake.json" >/dev/null

# Selected real Y3: current Year 3 views, retained Year 2 history, and full locked catalogue in unearned current view.
login_from_file "$Y3" "$TMP/y3.json" "$TMP/y3.jar" "$TMP/y3-login.json"
api_get "$TMP/y3.jar" '/api/v1/student/home' "$TMP/y3-home.json"
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year3" and .current==true and .group=="current")' "$TMP/y3-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year3" and .current==true and .group=="current")' "$TMP/y3-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year2" and .group=="previous")' "$TMP/y3-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year2" and .group=="previous")' "$TMP/y3-home.json" >/dev/null
api_get "$TMP/y3.jar" '/api/v1/student/views/english-year3/lessons' "$TMP/y3-current.json"
jq -e '(.lessons|length)>0 and ([.lessons[].locked]|all(.==true))' "$TMP/y3-current.json" >/dev/null
api_get "$TMP/y3.jar" '/api/v1/student/views/english-year2/lessons' "$TMP/y3-history.json"
jq -e '[.lessons[]|select(.locked==false)]|length>0' "$TMP/y3-history.json" >/dev/null

# Selected real Y5 11+: current 11+ English/Maths Level 3, retained Year 4 history, no current pregrant.
login_from_file "$Y5" "$TMP/y5.json" "$TMP/y5.jar" "$TMP/y5-login.json"
api_get "$TMP/y5.jar" '/api/v1/student/home' "$TMP/y5-home.json"
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year5-11plus" and .current==true and .group=="current")' "$TMP/y5-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-level3" and .current==true and .group=="current")' "$TMP/y5-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year4-11plus" and .group=="previous")' "$TMP/y5-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select((.viewId=="maths-level1" or .viewId=="maths-level2") and .group=="previous")' "$TMP/y5-home.json" >/dev/null
api_get "$TMP/y5.jar" '/api/v1/student/views/english-year5-11plus/lessons' "$TMP/y5-current.json"
jq -e '(.lessons|length)>0 and ([.lessons[].locked]|all(.==true))' "$TMP/y5-current.json" >/dev/null
api_get "$TMP/y5.jar" '/api/v1/student/views/english-year4-11plus/lessons' "$TMP/y5-history.json"
jq -e '[.lessons[]|select(.locked==false)]|length>0' "$TMP/y5-history.json" >/dev/null

# Protected Answer Pack: one selected real record must authorize per open without exposing raw R2.
PROTECTED_USER=''; PROTECTED_FILE=''; PROTECTED_JAR=''; PROTECTED_VIEW=''; PROTECTED_RESOURCE=''
for spec in "y3:$TMP/y3.json:$TMP/y3.jar:english-year2:$TMP/y3-history.json" "y5:$TMP/y5.json:$TMP/y5.jar:english-year4-11plus:$TMP/y5-history.json"; do
  IFS=: read -r label file jar view list <<<"$spec"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    api_get "$jar" "/api/v1/student/lessons/$(urlenc "$id")?viewId=$view" "$TMP/protected-candidate.json"
    ! grep -q '"r2Key"' "$TMP/protected-candidate.json"
    key="$(jq -r '[.lesson.homeworks[]?.answerPack? | select(.passwordRequired==true and .resourceKey!=null) | .resourceKey][0] // empty' "$TMP/protected-candidate.json")"
    if [ -n "$key" ]; then PROTECTED_USER="$label"; PROTECTED_FILE="$file"; PROTECTED_JAR="$jar"; PROTECTED_VIEW="$view"; PROTECTED_RESOURCE="$key"; break 2; fi
  done < <(jq -r '.lessons[]|select(.locked==false)|.lessonId' "$list")
done
test -n "$PROTECTED_RESOURCE" || fail 'no entitled protected Answer Pack found for selected real checks'
ANSWER="$(jq -r '.answerPassword' "$PROTECTED_FILE")"; mask "$ANSWER"
AUTH_PATH="/api/v1/student/resources/$(urlenc "$PROTECTED_RESOURCE")/answer/authorize?viewId=$PROTECTED_VIEW"
NO_CODE="$(api_code_post "$PROTECTED_JAR" "$AUTH_PATH" '{}' "$TMP/answer-no.json")"; test "$NO_CODE" = '403'; jq -e '.error=="ANSWER_PASSWORD_INCORRECT"' "$TMP/answer-no.json" >/dev/null
api_post "$PROTECTED_JAR" "$AUTH_PATH" "$(jq -cn --arg password "$ANSWER" '{password:$password}')" "$TMP/answer-ok.json"
jq -e '.ok==true and (.viewerPath|startswith("/api/v1/student/answer-view/")) and (.r2Key|not)' "$TMP/answer-ok.json" >/dev/null
VIEW_PATH="$(jq -r '.viewerPath' "$TMP/answer-ok.json")"; VIEW_TOKEN="$(jq -r '.token // empty' "$TMP/answer-ok.json")"; mask "$VIEW_TOKEN"
OPEN1="$(curl --silent --show-error --output "$TMP/answer.pdf" --write-out '%{http_code}' --cookie "$PROTECTED_JAR" --cookie-jar "$PROTECTED_JAR" --header "Origin: $ORIGIN" "$WORKER_BASE$VIEW_PATH")"; test "$OPEN1" = '200'; test -s "$TMP/answer.pdf"
OPEN2="$(api_code_get "$PROTECTED_JAR" "$VIEW_PATH" "$TMP/answer-second.json")"; test "$OPEN2" = '410'; jq -e '.error=="ANSWER_VIEW_ALREADY_OPENED"' "$TMP/answer-second.json" >/dev/null

# Controlled dummy exercises the production VR How-To special-resource wrapper using explicit stored ScreenPal URLs.
login_from_file "$DUMMY" "$TMP/dummy.json" "$TMP/dummy.jar" "$TMP/dummy-login.json"
api_get "$TMP/dummy.jar" '/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus' "$TMP/vr-area.json"
VR_KEY="$(jq -r '.area.items[]|select(.separator==false)|.resourceKey' "$TMP/vr-area.json" | head -n1)"; test -n "$VR_KEY"
api_get "$TMP/dummy.jar" "/api/v1/student/special-resources/$(urlenc "$VR_KEY")/video?viewId=english-year5-11plus" "$TMP/vr-video.json"
jq -e '.ok==true and (.embedUrl|type=="string" and startswith("https://go.screenpal.com/player/")) and (.r2Key|not)' "$TMP/vr-video.json" >/dev/null

# Normal logout path for all three accepted logins.
for spec in "$TMP/y3.jar:y3" "$TMP/y5.jar:y5" "$TMP/dummy.jar:dummy"; do
  IFS=: read -r jar label <<<"$spec"
  api_post "$jar" '/api/v1/student/auth/logout' '{}' "$TMP/logout-$label.json"; jq -e '.ok==true' "$TMP/logout-$label.json" >/dev/null
  code="$(api_code_get "$jar" '/api/v1/student/session' "$TMP/session-$label.json")"; test "$code" = '401'
done

echo 'PHASE17_SELECTED_REAL_DUMMY_ACCEPTANCE_PASS real_records=2 current_views=4 retained_history=true current_catalogues_locked=true protected_answer_per_open=true vr_howto_explicit=true identities_or_passwords_exposed=false'

# Explicit cleanup now; EXIT trap remains as a second safety net until final proof.
cleanup
ALLOWLIST_CHANGED=0; DUMMY_CREATED=0
mkdir -p "$TMP"
cf_get "$SETTINGS_URL" "$TMP/settings-after.json"
jq -e '.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text" and .text=="false")' "$TMP/settings-after.json" >/dev/null
test -z "$(jq -r '[.result.bindings[]|select(.name=="DEV_LOGIN_ALLOWLIST" and .type=="plain_text")|.text][0] // ""' "$TMP/settings-after.json")"
jq -r '.result.bindings[]|select(.type=="secret_text")|.name' "$TMP/settings-after.json" | sort > "$TMP/secrets-after.txt"
cmp -s "$TMP/secrets-before.txt" "$TMP/secrets-after.txt"
FAKE_FINAL="$(api_code_post "$TMP/final-fake.jar" '/api/v1/student/auth/login' '{"username":"__phase17_not_allowed__","password":"Aa1x"}' "$TMP/final-fake.json")"; test "$FAKE_FINAL" = '401'
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements; SELECT COUNT(*) AS b FROM batch_definitions; SELECT COUNT(*) AS a FROM student_batch_assignments; SELECT COUNT(*) AS r FROM batch_lesson_releases; PRAGMA quick_check;" "$TMP/final-d1.json"
test "$(jq -r '.[0].results[0].e' "$TMP/final-d1.json")" = '173'; test "$(jq -r '.[1].results[0].b' "$TMP/final-d1.json")" = '4'; test "$(jq -r '.[2].results[0].a' "$TMP/final-d1.json")" = '4'; test "$(jq -r '.[3].results[0].r' "$TMP/final-d1.json")" = '0'; jq -e '.[4].results[0].quick_check=="ok"' "$TMP/final-d1.json" >/dev/null

echo 'PHASE17_SELECTED_REAL_DUMMY_CLEANUP_PASS normal_login=false allowlist_empty=true dummy_removed=true d1=173/4/4/0 secrets_preserved=true'
trap - EXIT
rm -rf "$TMP"
