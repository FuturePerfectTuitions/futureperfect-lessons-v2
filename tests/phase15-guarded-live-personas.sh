#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN:?missing FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
ORIGIN='https://futureperfecttuitions.github.io'
TEST_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
TODAY="$(TZ=Europe/London date +%F)"
DAY_M1="$(date -u -d "$TODAY -1 day" +%F)"
DAY_M2="$(date -u -d "$TODAY -2 day" +%F)"
DAY_M3="$(date -u -d "$TODAY -3 day" +%F)"
TMP="$(mktemp -d)"
STUDENTS=''
LESSONS=''
MUTATION_STARTED=0
KVS_BACKED_UP=0

CONTROLLED_USERS=(testy5e testy5em testy511e test0505 test0606 test0404)
TEMP_BATCHES=(P15_M3A P15_M4B P15_E411)

fail(){ echo "ERROR: $*" >&2; exit 1; }
mask(){ [ -z "${1:-}" ] || echo "::add-mask::$1"; }
urlenc(){ node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

kv_value_url(){
  local namespace="$1" key="$2"
  printf 'https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s' \
    "$CLOUDFLARE_ACCOUNT_ID" "$namespace" "$(urlenc "$key")"
}

kv_get(){
  local namespace="$1" key="$2" out="$3"
  curl --fail --silent --show-error "$(kv_value_url "$namespace" "$key")" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$out"
}

kv_put(){
  local namespace="$1" key="$2" file="$3"
  curl --fail --silent --show-error --request PUT "$(kv_value_url "$namespace" "$key")" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    --header 'Content-Type: application/json' --data-binary "@$file" >/dev/null
}

d1(){
  local sql="$1" out="$2"
  $W d1 execute fpt_portal_v2_db --remote --json --command "$sql" >"$out" 2>"$out.err"
}

api_get(){
  local jar="$1" path="$2" out="$3"
  curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Accept: application/json' \
    "$WORKER_BASE$path" >"$out"
}

api_post(){
  local jar="$1" path="$2" body="$3" out="$4"
  curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Accept: application/json' \
    --header 'Content-Type: application/json' --request POST --data "$body" \
    "$WORKER_BASE$path" >"$out"
}

api_code_get(){
  local jar="$1" path="$2" out="$3"
  curl --silent --show-error --output "$out" --write-out '%{http_code}' \
    --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" \
    --header 'Accept: application/json' "$WORKER_BASE$path"
}

api_code_post(){
  local jar="$1" path="$2" body="$3" out="$4"
  curl --silent --show-error --output "$out" --write-out '%{http_code}' \
    --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" \
    --header 'Accept: application/json' --header 'Content-Type: application/json' \
    --request POST --data "$body" "$WORKER_BASE$path"
}

user_file(){ printf '%s/user-%s.json' "$TMP" "$1"; }

login_user(){
  local user="$1" jar="$2" out="$3" file password payload
  file="$(user_file "$user")"
  [ -s "$file" ] || kv_get "$STUDENTS" "user:$user" "$file"
  password="$(jq -r '.p // empty' "$file")"
  [ -n "$password" ] || fail "controlled login fixture lacks a login credential"
  mask "$password"
  payload="$(jq -cn --arg username "$user" --arg password "$password" '{username:$username,password:$password}')"
  api_post "$jar" '/api/v1/student/auth/login' "$payload" "$out"
  jq -e '.ok == true' "$out" >/dev/null
}

cookie_token(){
  awk '$6=="fpt_v2_session" {v=$7} END {print v}' "$1"
}

token_hash(){
  node -e 'const c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"
}

curriculum_ids(){
  local code="$1" file="$TMP/curriculum-$code.json"
  kv_get "$LESSONS" "curriculum:$code" "$file"
  node - "$file" <<'NODE'
const fs=require('node:fs');
const file=process.argv[2];
const raw=JSON.parse(fs.readFileSync(file,'utf8'));
const items=Array.isArray(raw)?raw:(raw.lessonIds||raw.lessons||raw.items||[]);
for(const item of items){
  const id=typeof item==='string'?item:String(item?.lessonId||'');
  if(id) console.log(id);
}
NODE
}

first_lesson(){ curriculum_ids "$1" | head -n1; }

first_vr_lesson(){
  local code="$1" id record="$TMP/vr-candidate.json"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    kv_get "$LESSONS" "lesson:$id" "$record"
    if jq -e '.active != false and .vr != null and ([.vr | .. | objects | (.r2Key? // .r2? // empty)] | length > 0)' "$record" >/dev/null; then
      printf '%s' "$id"
      return 0
    fi
  done < <(curriculum_ids "$code")
  return 1
}

sync_one(){
  local operation="$1" rowid="$2" user="$3" lesson="$4" batch="$5" lesson_date="$6" out="$7" payload
  payload="$(jq -cn --arg operation "$operation" --arg syncRowId "$rowid" --arg portalUserId "$user" \
    --arg lessonId "$lesson" --arg batchKey "$batch" --arg lessonDate "$lesson_date" \
    '{items:[{operation:$operation,syncRowId:$syncRowId,portalUserId:$portalUserId,lessonId:$lessonId,batchKey:$batchKey,lessonDate:$lessonDate}]}')"
  curl --fail-with-body --silent --show-error --request POST \
    --header "Authorization: Bearer ${FPT_PORTAL_V2_EXCEL_SYNC_TOKEN}" \
    --header 'Content-Type: application/json' --data "$payload" \
    "$WORKER_BASE/api/v1/admin/excel-entitlements/sync" >"$out"
}

assert_no_gated_refs(){
  local file="$1"
  jq -e '([.. | objects | keys[]] | all(. != "screenpal" and . != "sp" and . != "embedUrl" and . != "r2Key" and . != "r2" and . != "url"))' "$file" >/dev/null
}

restore_users(){
  [ "$KVS_BACKED_UP" -eq 1 ] || return 0
  for user in testy5e testy5em testy511e; do
    [ -s "$TMP/original-$user.json" ] && kv_put "$STUDENTS" "user:$user" "$TMP/original-$user.json"
  done
}

cleanup_d1(){
  local ids="'testy5e','testy5em','testy511e','test0505','test0606','test0404'"
  local sql
  sql="DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'); DELETE FROM mock_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'); DELETE FROM answer_view_tokens WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'; DELETE FROM student_session_profiles WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'; DELETE FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'; DELETE FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND source_batch_code IN ('P15_M3A','P15_M4B','P15_E411'); DELETE FROM batch_lesson_releases WHERE batch_key IN ('P15_M3A','P15_M4B','P15_E411'); DELETE FROM student_batch_assignments WHERE portal_user_id_norm='testy5e' AND batch_key IN ('P15_M3A','P15_M4B','P15_E411'); DELETE FROM batch_definitions WHERE batch_key IN ('P15_M3A','P15_M4B','P15_E411');"
  d1 "$sql" "$TMP/cleanup.json"
}

cleanup(){
  local rc=0
  set +e
  if [ "$MUTATION_STARTED" -eq 1 ]; then
    restore_users || rc=1
    cleanup_d1 || rc=1
  fi
  set -e
  return "$rc"
}

on_exit(){
  local status=$?
  trap - EXIT
  if ! cleanup; then
    echo 'ERROR: Phase 15 guarded cleanup failed.' >&2
    exit 97
  fi
  exit "$status"
}
trap on_exit EXIT

echo 'Phase 15 guarded persona matrix: read-only preflight.'

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$TMP/settings.json"
jq -e '.success == true' "$TMP/settings.json" >/dev/null
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' "$TMP/settings.json" >/dev/null
LOGIN_ENABLED="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' "$TMP/settings.json")"
case "${LOGIN_ENABLED,,}" in ''|'false') ;; *) fail 'normal V2 student login is enabled';; esac
STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings.json")"
LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings.json")"
R2="$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' "$TMP/settings.json")"
ALLOWLIST="$(jq -r '[.result.bindings[]|select(.name=="DEV_LOGIN_ALLOWLIST" and .type=="plain_text")|.text][0] // ""' "$TMP/settings.json")"
test -n "$STUDENTS" && test "$STUDENTS" != null
test -n "$LESSONS" && test "$LESSONS" != null
test "$R2" = 'fpt-materials-dev'
for user in "${CONTROLLED_USERS[@]}"; do
  case ",${ALLOWLIST,,}," in *",${user},"*) ;; *) fail 'required established development persona is not authorised by the deployed development allowlist';; esac
done

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$TMP/namespaces.json"
LEGACY="$(jq -r '[.result[]|select(.title=="FPT_LESSONS_TEST")|.id][0] // ""' "$TMP/namespaces.json")"
if [ -n "$LEGACY" ]; then test "$LESSONS" != "$LEGACY"; fi

BASE_SQL="SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements; SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments; SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments); SELECT COUNT(*) AS temp_batches FROM batch_definitions WHERE batch_key IN ('P15_M3A','P15_M4B','P15_E411'); SELECT COUNT(*) AS temp_assignments FROM student_batch_assignments WHERE batch_key IN ('P15_M3A','P15_M4B','P15_E411') OR portal_user_id_norm='__phase15_fixture__'; SELECT COUNT(*) AS temp_releases FROM batch_lesson_releases WHERE batch_key IN ('P15_M3A','P15_M4B','P15_E411'); SELECT COUNT(*) AS temp_entitlements FROM lesson_entitlements WHERE source_batch_code IN ('P15_M3A','P15_M4B','P15_E411'); SELECT COUNT(*) AS active_controlled_sessions FROM student_sessions WHERE portal_user_id_norm IN ('testy5e','testy5em','testy511e','test0505','test0606','test0404') AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'); SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;"
d1 "$BASE_SQL" "$TMP/before.json"
test "$(jq -r '.[0].results[0].entitlement_count' "$TMP/before.json")" = '632'
test "$(jq -r '.[1].results[0].batch_count' "$TMP/before.json")" = '4'
test "$(jq -r '.[2].results[0].assignment_count' "$TMP/before.json")" = '4'
test "$(jq -r '.[3].results[0].release_count' "$TMP/before.json")" = '0'
test "$(jq -r '.[4].results[0].assigned_users' "$TMP/before.json")" = '2'
test "$(jq -r '.[5].results[0].assigned_user_entitlements' "$TMP/before.json")" = '173'
for i in 6 7 8 9 10; do test "$(jq -r ".[$i].results[0] | to_entries[0].value" "$TMP/before.json")" = '0'; done
jq -e '.[11].results[0].name == "trg_student_sessions_single_active"' "$TMP/before.json" >/dev/null
jq -e '.[12].results[0].quick_check == "ok"' "$TMP/before.json" >/dev/null

for user in testy5e testy5em testy511e; do
  kv_get "$STUDENTS" "user:$user" "$TMP/original-$user.json"
  cp "$TMP/original-$user.json" "$(user_file "$user")"
done
for user in test0505 test0606 test0404; do kv_get "$STUDENTS" "user:$user" "$(user_file "$user")"; done
KVS_BACKED_UP=1

M3_LESSON="$(first_lesson MATHS_Y3)"
M4_LESSON="$(first_lesson MATHS_L1)"
E4_LESSON="$(first_lesson ENGLISH_Y4)"
E4_VR_LESSON="$(first_vr_lesson ENGLISH_Y4)"
for value in "$M3_LESSON" "$M4_LESSON" "$E4_LESSON" "$E4_VR_LESSON"; do test -n "$value"; done
for spec in "$M3_LESSON:maths" "$M4_LESSON:maths" "$E4_LESSON:english" "$E4_VR_LESSON:english"; do
  id="${spec%%:*}"; subject="${spec##*:}"
  kv_get "$LESSONS" "lesson:$id" "$TMP/lesson-$id.json"
  jq -e --arg id "$id" --arg subject "$subject" '.lessonId==$id and .subject==$subject and .active != false' "$TMP/lesson-$id.json" >/dev/null
done

d1 "SELECT COUNT(*) AS c FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id IN ('${M3_LESSON}','${M4_LESSON}','${E4_LESSON}','${E4_VR_LESSON}'); SELECT COUNT(*) AS c FROM student_batch_assignments WHERE portal_user_id_norm='testy5e';" "$TMP/target-absence.json"
test "$(jq -r '.[0].results[0].c' "$TMP/target-absence.json")" = '0'
test "$(jq -r '.[1].results[0].c' "$TMP/target-absence.json")" = '0'

echo 'Preflight PASS: exact baseline, controlled users and authoritative lesson fixtures established.'
MUTATION_STARTED=1

# P15-P17: live special-area positive/negative presentation without printing credentials.
JAR="$TMP/special5.jar"; login_user test0505 "$JAR" "$TMP/special5-login.json"
api_get "$JAR" '/api/v1/student/special-areas?viewId=maths-level3' "$TMP/special5-maths.json"
jq -e '[.areas[].bucketId] | sort == ["MOCKS","Y5MAssT1","Y5MAssT2"]' "$TMP/special5-maths.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas?viewId=english-year5-11plus' "$TMP/special5-english.json"
jq -e '[.areas[].bucketId] | sort == ["MOCKS","VR_HOWTO"]' "$TMP/special5-english.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas/Y5MAssT1?viewId=maths-level3' "$TMP/assessment.json"
ASSESS_KEY="$(jq -r '.area.items[] | select(.separator==false) | .resourceKey' "$TMP/assessment.json" | head -n1)"
test -n "$ASSESS_KEY" && test "$ASSESS_KEY" != null
api_get "$JAR" "/api/v1/student/special-resources/$(urlenc "$ASSESS_KEY")/video?viewId=maths-level3" "$TMP/assessment-open.json"
jq -e '.ok==true and (.embedUrl|startswith("https://go.screenpal.com/player/"))' "$TMP/assessment-open.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus' "$TMP/vrhowto.json"
VR_KEY="$(jq -r '.area.items[] | select(.separator==false) | .resourceKey' "$TMP/vrhowto.json" | head -n1)"
test -n "$VR_KEY" && test "$VR_KEY" != null
api_get "$JAR" "/api/v1/student/special-resources/$(urlenc "$VR_KEY")/video?viewId=english-year5-11plus" "$TMP/vrhowto-open.json"
jq -e '.ok==true and (.embedUrl|startswith("https://go.screenpal.com/player/"))' "$TMP/vrhowto-open.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas/MOCKS?viewId=maths-level3' "$TMP/mocks-locked.json"
jq -e '.area.passwordProtected==true and .area.passwordScope=="mock-day-browser-session"' "$TMP/mocks-locked.json" >/dev/null
assert_no_gated_refs "$TMP/mocks-locked.json"
BAD_MOCK="$(node -e 'const c=require("node:crypto");process.stdout.write("P"+c.randomInt(0,10)+"x"+c.randomInt(0,10))')"; mask "$BAD_MOCK"
MOCK_CODE="$(api_code_post "$JAR" '/api/v1/student/special-areas/MOCKS/mock-days/1/unlock?viewId=maths-level3' "$(jq -cn --arg password "$BAD_MOCK" '{password:$password}')" "$TMP/mocks-wrong.json")"
test "$MOCK_CODE" = '403'; jq -e '.error=="MOCK_PASSWORD_INCORRECT"' "$TMP/mocks-wrong.json" >/dev/null; assert_no_gated_refs "$TMP/mocks-wrong.json"
JAR="$TMP/special4.jar"; login_user test0606 "$JAR" "$TMP/special4-login.json"
api_get "$JAR" '/api/v1/student/special-areas?viewId=maths-level2' "$TMP/special4-maths.json"
jq -e '[.areas[].bucketId] | sort == ["Y4MAssT1","Y4MAssT2"]' "$TMP/special4-maths.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas?viewId=english-year4-11plus' "$TMP/special4-english.json"
jq -e '[.areas[].bucketId] == ["VR_HOWTO"]' "$TMP/special4-english.json" >/dev/null
JAR="$TMP/special-none.jar"; login_user test0404 "$JAR" "$TMP/special-none-login.json"
api_get "$JAR" '/api/v1/student/special-areas?viewId=english-year5-11plus' "$TMP/special-none.json"
jq -e '.areas==[]' "$TMP/special-none.json" >/dev/null
DENIED="$(api_code_get "$JAR" '/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus' "$TMP/special-denied.json")"
test "$DENIED" = '403'; jq -e '.error=="SPECIAL_ACCESS_REQUIRED"' "$TMP/special-denied.json" >/dev/null
echo 'P15-P17 special-area presentation gates: PASS.'

# P13 ordinary Full Library: access source must not fabricate D1 entitlement.
jq --arg lib 'ENGLISH_Y4_FULL' '.fullLibraries=[$lib]' "$TMP/original-testy5e.json" >"$TMP/testy5e-full-normal.json"
kv_put "$STUDENTS" 'user:testy5e' "$TMP/testy5e-full-normal.json"
cp "$TMP/testy5e-full-normal.json" "$(user_file testy5e)"
JAR="$TMP/full-normal.jar"; login_user testy5e "$JAR" "$TMP/full-normal-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/full-normal-home.json"
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year4" and .source=="fullLibrary")' "$TMP/full-normal-home.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/english-year4/lessons' "$TMP/full-normal-lessons.json"
jq -e --arg id "$E4_LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/full-normal-lessons.json" >/dev/null
d1 "SELECT COUNT(*) AS c FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id='${E4_LESSON}';" "$TMP/full-normal-d1.json"
test "$(jq -r '.[0].results[0].c' "$TMP/full-normal-d1.json")" = '0'
kv_put "$STUDENTS" 'user:testy5e' "$TMP/original-testy5e.json"; cp "$TMP/original-testy5e.json" "$(user_file testy5e)"
echo 'P13 ordinary Full Library: PASS.'

# P14 11+ Full Library with VR: VR entitlement is library-scoped; VR How-To remains separate.
jq --arg lib 'ENGLISH_Y4_11PLUS_FULL' '.fullLibraries=[$lib]' "$TMP/original-testy5e.json" >"$TMP/testy5e-full-11.json"
kv_put "$STUDENTS" 'user:testy5e' "$TMP/testy5e-full-11.json"; cp "$TMP/testy5e-full-11.json" "$(user_file testy5e)"
JAR="$TMP/full-11.jar"; login_user testy5e "$JAR" "$TMP/full-11-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/full-11-home.json"
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year4-11plus" and .source=="fullLibrary")' "$TMP/full-11-home.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/english-year4-11plus/lessons' "$TMP/full-11-lessons.json"
jq -e --arg id "$E4_VR_LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/full-11-lessons.json" >/dev/null
api_get "$JAR" "/api/v1/student/lessons/$(urlenc "$E4_VR_LESSON")?viewId=english-year4-11plus" "$TMP/full-11-detail.json"
jq -e '.lesson.locked==false and .lesson.vr != null' "$TMP/full-11-detail.json" >/dev/null
jq -e '([.lesson.vr | .. | objects | .resourceKey? // empty] | length) > 0' "$TMP/full-11-detail.json" >/dev/null
api_get "$JAR" '/api/v1/student/special-areas?viewId=english-year4-11plus' "$TMP/full-11-special.json"
jq -e '.areas==[]' "$TMP/full-11-special.json" >/dev/null
d1 "SELECT COUNT(*) AS c FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id='${E4_VR_LESSON}';" "$TMP/full-11-d1.json"
test "$(jq -r '.[0].results[0].c' "$TMP/full-11-d1.json")" = '0'
kv_put "$STUDENTS" 'user:testy5e' "$TMP/original-testy5e.json"; cp "$TMP/original-testy5e.json" "$(user_file testy5e)"
echo 'P14 11+ Full Library/VR separation: PASS.'

# P24 one-off guest/manual individual lesson access: no membership or D1 entitlement mutation.
jq --arg id "$E4_LESSON" '.manualAccess.coreLessons=((.manualAccess.coreLessons // []) + [$id] | unique)' "$TMP/original-testy5e.json" >"$TMP/testy5e-guest.json"
kv_put "$STUDENTS" 'user:testy5e' "$TMP/testy5e-guest.json"; cp "$TMP/testy5e-guest.json" "$(user_file testy5e)"
JAR="$TMP/guest.jar"; login_user testy5e "$JAR" "$TMP/guest-login.json"
api_get "$JAR" '/api/v1/student/views/english-year4/lessons' "$TMP/guest-lessons.json"
jq -e --arg id "$E4_LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/guest-lessons.json" >/dev/null
d1 "SELECT COUNT(*) AS a FROM student_batch_assignments WHERE portal_user_id_norm='testy5e'; SELECT COUNT(*) AS e FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id='${E4_LESSON}';" "$TMP/guest-d1.json"
test "$(jq -r '.[0].results[0].a' "$TMP/guest-d1.json")" = '0'; test "$(jq -r '.[1].results[0].e' "$TMP/guest-d1.json")" = '0'
kv_put "$STUDENTS" 'user:testy5e' "$TMP/original-testy5e.json"; cp "$TMP/original-testy5e.json" "$(user_file testy5e)"
echo 'P24 one-off/manual individual access without membership mutation: PASS.'

# P09/P10/P11/P12/P23: effective dates, join, transfer, leave/rejoin, subject independence and absence-independent release.
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
SEED="INSERT INTO batch_definitions (batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to,created_at,updated_at) VALUES ('P15_M3A','2026-27','maths',3,'normal',NULL,'${DAY_M3}',NULL,'${NOW}','${NOW}'),('P15_M4B','2026-27','maths',4,'normal',NULL,'${DAY_M3}',NULL,'${NOW}','${NOW}'),('P15_E411','2026-27','english',4,'11plus',NULL,'${DAY_M3}',NULL,'${NOW}','${NOW}'); INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5e','P15_M3A','${DAY_M2}',NULL,'${NOW}','${NOW}');"
d1 "$SEED" "$TMP/seed.json"
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements; SELECT COUNT(*) AS r FROM batch_lesson_releases;" "$TMP/seed-counts.json"
test "$(jq -r '.[0].results[0].e' "$TMP/seed-counts.json")" = '632'; test "$(jq -r '.[1].results[0].r' "$TMP/seed-counts.json")" = '0'
JAR="$TMP/join.jar"; login_user testy5e "$JAR" "$TMP/join-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/join-home.json"
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year3" and .current==true and .group=="current")' "$TMP/join-home.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/maths-year3/lessons' "$TMP/join-lessons-before.json"
jq -e --arg id "$M3_LESSON" '.lessons[]|select(.lessonId==$id and .locked==true)' "$TMP/join-lessons-before.json" >/dev/null
sync_one grant p15-prejoin testy5e "$M3_LESSON" P15_M3A "$DAY_M3" "$TMP/prejoin.json"
jq -e '.results[0].ok==false and .results[0].status=="NOT_ASSIGNED_ON_LESSON_DATE"' "$TMP/prejoin.json" >/dev/null
sync_one grant p15-join testy5e "$M3_LESSON" P15_M3A "$TODAY" "$TMP/join-grant.json"
jq -e '.results[0].ok==true and .results[0].status=="CREATED"' "$TMP/join-grant.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/maths-year3/lessons' "$TMP/join-lessons-after.json"
jq -e --arg id "$M3_LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/join-lessons-after.json" >/dev/null
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements; SELECT COUNT(*) AS r FROM batch_lesson_releases;" "$TMP/join-counts.json"
test "$(jq -r '.[0].results[0].e' "$TMP/join-counts.json")" = '633'; test "$(jq -r '.[1].results[0].r' "$TMP/join-counts.json")" = '1'
echo 'P09 mid-term join/effective_from and P23 assignment-only release gate: PASS.'

TRANSFER="UPDATE student_batch_assignments SET effective_to='${TODAY}',updated_at='${NOW}' WHERE portal_user_id_norm='testy5e' AND batch_key='P15_M3A' AND effective_to IS NULL; INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5e','P15_M4B','${TODAY}',NULL,'${NOW}','${NOW}');"
d1 "$TRANSFER" "$TMP/transfer.json"
JAR="$TMP/transfer.jar"; login_user testy5e "$JAR" "$TMP/transfer-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/transfer-home.json"
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year4" and .current==true)' "$TMP/transfer-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year3" and .current==false and .group=="previous")' "$TMP/transfer-home.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/maths-year4/lessons' "$TMP/transfer-y4-before.json"
jq -e --arg id "$M4_LESSON" '.lessons[]|select(.lessonId==$id and .locked==true)' "$TMP/transfer-y4-before.json" >/dev/null
sync_one grant p15-transfer testy5e "$M4_LESSON" P15_M4B "$TODAY" "$TMP/transfer-grant.json"
jq -e '.results[0].ok==true and .results[0].status=="CREATED"' "$TMP/transfer-grant.json" >/dev/null
api_get "$JAR" '/api/v1/student/views/maths-year3/lessons' "$TMP/transfer-y3-retained.json"
jq -e --arg id "$M3_LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/transfer-y3-retained.json" >/dev/null
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id IN ('${M3_LESSON}','${M4_LESSON}');" "$TMP/transfer-count.json"
test "$(jq -r '.[0].results[0].e' "$TMP/transfer-count.json")" = '2'
echo 'P10 transfer/history/no earlier-batch inheritance: PASS.'

# Close the active Maths assignment today by moving its test-only start to yesterday first; retained D1 lessons must survive.
d1 "UPDATE student_batch_assignments SET effective_from='${DAY_M1}',effective_to='${TODAY}',updated_at='${NOW}' WHERE portal_user_id_norm='testy5e' AND batch_key='P15_M4B' AND effective_to IS NULL;" "$TMP/leave.json"
JAR="$TMP/leave.jar"; login_user testy5e "$JAR" "$TMP/leave-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/leave-home.json"
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year5" and .current==true)' "$TMP/leave-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year3" and .current==false)' "$TMP/leave-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year4" and .current==false)' "$TMP/leave-home.json" >/dev/null
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements WHERE portal_user_id_norm='testy5e' AND lesson_id IN ('${M3_LESSON}','${M4_LESSON}');" "$TMP/leave-entitlements.json"
test "$(jq -r '.[0].results[0].e' "$TMP/leave-entitlements.json")" = '2'
d1 "INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5e','P15_M4B','${TODAY}',NULL,'${NOW}','${NOW}');" "$TMP/rejoin.json"
JAR="$TMP/rejoin.jar"; login_user testy5e "$JAR" "$TMP/rejoin-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/rejoin-home.json"
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year4" and .current==true)' "$TMP/rejoin-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year5" and .current==true)' "$TMP/rejoin-home.json" >/dev/null
echo 'P11 leave/rejoin and P12 stop-one-subject/retain-history: PASS.'

# P06: active English 11+ core access without VR entitlement.
d1 "INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5e','P15_E411','${TODAY}',NULL,'${NOW}','${NOW}');" "$TMP/e411-assignment.json"
JAR="$TMP/e411-locked.jar"; login_user testy5e "$JAR" "$TMP/e411-locked-login.json"
api_get "$JAR" '/api/v1/student/views/english-year4-11plus/lessons' "$TMP/e411-before.json"
jq -e --arg id "$E4_VR_LESSON" '.lessons[]|select(.lessonId==$id and .locked==true)' "$TMP/e411-before.json" >/dev/null
jq --arg id "$E4_VR_LESSON" '.manualAccess.coreLessons=((.manualAccess.coreLessons // []) + [$id] | unique)' "$TMP/original-testy5e.json" >"$TMP/testy5e-11-core-only.json"
kv_put "$STUDENTS" 'user:testy5e' "$TMP/testy5e-11-core-only.json"; cp "$TMP/testy5e-11-core-only.json" "$(user_file testy5e)"
JAR="$TMP/e411-core.jar"; login_user testy5e "$JAR" "$TMP/e411-core-login.json"
api_get "$JAR" "/api/v1/student/lessons/$(urlenc "$E4_VR_LESSON")?viewId=english-year4-11plus" "$TMP/e411-core-detail.json"
jq -e '.lesson.locked==false' "$TMP/e411-core-detail.json" >/dev/null
jq -e '([.lesson.vr // {} | .. | objects | .resourceKey? // empty] | length) == 0' "$TMP/e411-core-detail.json" >/dev/null
kv_put "$STUDENTS" 'user:testy5e' "$TMP/original-testy5e.json"; cp "$TMP/original-testy5e.json" "$(user_file testy5e)"
echo 'P06 English 11+ core without VR: PASS.'

# P18 session lifecycle on a controlled established persona.
LOGIN_PASSWORD="$(jq -r '.p' "$TMP/original-testy5em.json")"; mask "$LOGIN_PASSWORD"
JAR_A="$TMP/session-a.jar"; login_user testy5em "$JAR_A" "$TMP/session-a-login.json"
TOKEN_A="$(cookie_token "$JAR_A")"; test -n "$TOKEN_A"; mask "$TOKEN_A"; HASH_A="$(token_hash "$TOKEN_A")"; mask "$HASH_A"
test "$TOKEN_A" != "$LOGIN_PASSWORD"; test "$TOKEN_A" != 'testy5em'; test "${#HASH_A}" = '64'
d1 "SELECT COUNT(*) AS c FROM student_sessions WHERE token_hash='${HASH_A}' AND portal_user_id_norm='testy5em' AND revoked_at IS NULL;" "$TMP/session-a-d1.json"
test "$(jq -r '.[0].results[0].c' "$TMP/session-a-d1.json")" = '1'
JAR_B="$TMP/session-b.jar"; login_user testy5em "$JAR_B" "$TMP/session-b-login.json"
OLD_CODE="$(api_code_get "$JAR_A" '/api/v1/student/session' "$TMP/session-a-old.json")"; test "$OLD_CODE" = '401'
d1 "SELECT COUNT(*) AS c FROM student_sessions WHERE portal_user_id_norm='testy5em' AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');" "$TMP/session-active.json"
test "$(jq -r '.[0].results[0].c' "$TMP/session-active.json")" = '1'
api_post "$JAR_B" '/api/v1/student/auth/logout' '{}' "$TMP/logout.json"; jq -e '.ok==true' "$TMP/logout.json" >/dev/null
LOGOUT_CODE="$(api_code_get "$JAR_B" '/api/v1/student/session' "$TMP/logout-session.json")"; test "$LOGOUT_CODE" = '401'
JAR_C="$TMP/session-idle.jar"; login_user testy5em "$JAR_C" "$TMP/session-idle-login.json"
TOKEN_C="$(cookie_token "$JAR_C")"; mask "$TOKEN_C"; HASH_C="$(token_hash "$TOKEN_C")"; mask "$HASH_C"
d1 "UPDATE student_sessions SET idle_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second'),last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours','-1 second') WHERE token_hash='${HASH_C}';" "$TMP/session-expire.json"
IDLE_CODE="$(api_code_get "$JAR_C" '/api/v1/student/session' "$TMP/session-expired.json")"; test "$IDLE_CODE" = '401'; jq -e '.error=="SESSION_EXPIRED"' "$TMP/session-expired.json" >/dev/null
echo 'P18 opaque/single-device/logout/2-hour inactivity: PASS.'

# P19 controlled reset effect: modify only the test persona credential, revoke its active session, restore exact KV.
JAR_R="$TMP/reset-old.jar"; login_user testy5em "$JAR_R" "$TMP/reset-old-login.json"
TOKEN_R="$(cookie_token "$JAR_R")"; mask "$TOKEN_R"; HASH_R="$(token_hash "$TOKEN_R")"; mask "$HASH_R"
ALT_LOGIN="$(node -e 'const c=require("node:crypto");const d=c.randomInt(0,10);const u=String.fromCharCode(65+c.randomInt(0,26));process.stdout.write("Aq"+d+u)')"; mask "$ALT_LOGIN"
while [ "$ALT_LOGIN" = "$LOGIN_PASSWORD" ]; do ALT_LOGIN="$(node -e 'const c=require("node:crypto");process.stdout.write("Bz"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"; mask "$ALT_LOGIN"; done
jq --arg p "$ALT_LOGIN" '.p=$p' "$TMP/original-testy5em.json" >"$TMP/testy5em-reset.json"
kv_put "$STUDENTS" 'user:testy5em' "$TMP/testy5em-reset.json"; cp "$TMP/testy5em-reset.json" "$(user_file testy5em)"
d1 "UPDATE student_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash='${HASH_R}' AND revoked_at IS NULL;" "$TMP/reset-revoke.json"
RESET_SESSION_CODE="$(api_code_get "$JAR_R" '/api/v1/student/session' "$TMP/reset-old-session.json")"; test "$RESET_SESSION_CODE" = '401'
OLD_LOGIN_CODE="$(api_code_post "$TMP/reset-old-credential.jar" '/api/v1/student/auth/login' "$(jq -cn --arg username testy5em --arg password "$LOGIN_PASSWORD" '{username:$username,password:$password}')" "$TMP/reset-old-credential.json")"; test "$OLD_LOGIN_CODE" = '401'
api_post "$TMP/reset-new.jar" '/api/v1/student/auth/login' "$(jq -cn --arg username testy5em --arg password "$ALT_LOGIN" '{username:$username,password:$password}')" "$TMP/reset-new-login.json"; jq -e '.ok==true' "$TMP/reset-new-login.json" >/dev/null
kv_put "$STUDENTS" 'user:testy5em' "$TMP/original-testy5em.json"; cp "$TMP/original-testy5em.json" "$(user_file testy5em)"
d1 "UPDATE student_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE portal_user_id_norm='testy5em' AND created_at >= '${TEST_START}' AND revoked_at IS NULL;" "$TMP/reset-final-revoke.json"
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements; SELECT COUNT(*) AS a FROM student_batch_assignments;" "$TMP/reset-invariants.json"
test "$(jq -r '.[0].results[0].e' "$TMP/reset-invariants.json")" = '634'; test "$(jq -r '.[1].results[0].a' "$TMP/reset-invariants.json")" = '7'
echo 'P19 controlled login-reset effects: PASS.'

# P20 protected Answer Pack lifecycle; discover an entitled protected answer from authoritative deployed data.
JAR_P="$TMP/protected.jar"; login_user testy5em "$JAR_P" "$TMP/protected-login.json"
ANSWER_PASSWORD="$(jq -r '.answerPassword' "$TMP/original-testy5em.json")"; mask "$ANSWER_PASSWORD"
api_get "$JAR_P" '/api/v1/student/views/maths-year5/lessons' "$TMP/protected-list.json"
PROTECTED_LESSON=''; RESOURCE_KEY=''
while IFS= read -r id; do
  api_get "$JAR_P" "/api/v1/student/lessons/$(urlenc "$id")?viewId=maths-year5" "$TMP/protected-candidate.json"
  key="$(jq -r '[.lesson.homeworks[]?.answerPack? | select(.passwordRequired==true and .resourceKey!=null) | .resourceKey][0] // empty' "$TMP/protected-candidate.json")"
  if [ -n "$key" ]; then PROTECTED_LESSON="$id"; RESOURCE_KEY="$key"; break; fi
done < <(jq -r '.lessons[]|select(.locked==false)|.lessonId' "$TMP/protected-list.json")
test -n "$PROTECTED_LESSON"; test -n "$RESOURCE_KEY"
ENC_KEY="$(urlenc "$RESOURCE_KEY")"
AUTH_PATH="/api/v1/student/resources/${ENC_KEY}/answer/authorize?viewId=maths-year5"
NO_PWD_CODE="$(api_code_post "$JAR_P" "$AUTH_PATH" '{}' "$TMP/answer-no-password.json")"; test "$NO_PWD_CODE" = '403'; jq -e '.error=="ANSWER_PASSWORD_INCORRECT"' "$TMP/answer-no-password.json" >/dev/null
WRONG_ANSWER="$(node -e 'const c=require("node:crypto");process.stdout.write("Qw"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"; mask "$WRONG_ANSWER"
while [ "$WRONG_ANSWER" = "$ANSWER_PASSWORD" ]; do WRONG_ANSWER="$(node -e 'const c=require("node:crypto");process.stdout.write("Er"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"; mask "$WRONG_ANSWER"; done
BAD_ANSWER_CODE="$(api_code_post "$JAR_P" "$AUTH_PATH" "$(jq -cn --arg password "$WRONG_ANSWER" '{password:$password}')" "$TMP/answer-wrong.json")"; test "$BAD_ANSWER_CODE" = '403'
api_post "$JAR_P" "$AUTH_PATH" "$(jq -cn --arg password "$ANSWER_PASSWORD" '{password:$password}')" "$TMP/answer-authorized.json"
jq -e '.ok==true and (.token|type=="string") and (.viewerPath|startswith("/api/v1/student/answer-view/")) and (.r2Key|not)' "$TMP/answer-authorized.json" >/dev/null
VIEW_TOKEN="$(jq -r '.token' "$TMP/answer-authorized.json")"; mask "$VIEW_TOKEN"; VIEW_PATH="$(jq -r '.viewerPath' "$TMP/answer-authorized.json")"
FIRST_VIEW_CODE="$(curl --silent --show-error --output "$TMP/answer.pdf" --write-out '%{http_code}' --cookie "$JAR_P" --cookie-jar "$JAR_P" --header "Origin: $ORIGIN" "$WORKER_BASE$VIEW_PATH")"; test "$FIRST_VIEW_CODE" = '200'
SECOND_VIEW_CODE="$(api_code_get "$JAR_P" "$VIEW_PATH" "$TMP/answer-second.json")"; test "$SECOND_VIEW_CODE" = '410'; jq -e '.error=="ANSWER_VIEW_ALREADY_OPENED"' "$TMP/answer-second.json" >/dev/null
api_post "$JAR_P" "$AUTH_PATH" "$(jq -cn --arg password "$ANSWER_PASSWORD" '{password:$password}')" "$TMP/answer-authorized-2.json"
VIEW_PATH_2="$(jq -r '.viewerPath' "$TMP/answer-authorized-2.json")"; VIEW_TOKEN_2="$(jq -r '.token' "$TMP/answer-authorized-2.json")"; mask "$VIEW_TOKEN_2"
ALT_ANSWER="$(node -e 'const c=require("node:crypto");process.stdout.write("Ty"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"; mask "$ALT_ANSWER"
while [ "$ALT_ANSWER" = "$ANSWER_PASSWORD" ]; do ALT_ANSWER="$(node -e 'const c=require("node:crypto");process.stdout.write("Ui"+c.randomInt(0,10)+String.fromCharCode(65+c.randomInt(0,26)))')"; mask "$ALT_ANSWER"; done
jq --arg p "$ALT_ANSWER" '.answerPassword=$p' "$TMP/original-testy5em.json" >"$TMP/testy5em-answer-change.json"
kv_put "$STUDENTS" 'user:testy5em' "$TMP/testy5em-answer-change.json"; cp "$TMP/testy5em-answer-change.json" "$(user_file testy5em)"
CHANGED_CODE="$(api_code_get "$JAR_P" "$VIEW_PATH_2" "$TMP/answer-changed.json")"; test "$CHANGED_CODE" = '410'; jq -e '.error=="ANSWER_VIEW_INVALID"' "$TMP/answer-changed.json" >/dev/null
kv_put "$STUDENTS" 'user:testy5em' "$TMP/original-testy5em.json"; cp "$TMP/original-testy5em.json" "$(user_file testy5em)"
api_post "$JAR_P" "$AUTH_PATH" "$(jq -cn --arg password "$ANSWER_PASSWORD" '{password:$password}')" "$TMP/answer-authorized-3.json"
VIEW_PATH_3="$(jq -r '.viewerPath' "$TMP/answer-authorized-3.json")"; VIEW_TOKEN_3="$(jq -r '.token' "$TMP/answer-authorized-3.json")"; mask "$VIEW_TOKEN_3"
TOKEN_P="$(cookie_token "$JAR_P")"; mask "$TOKEN_P"; HASH_P="$(token_hash "$TOKEN_P")"; mask "$HASH_P"
d1 "UPDATE student_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash='${HASH_P}' AND revoked_at IS NULL;" "$TMP/answer-session-revoke.json"
REVOKED_VIEW_CODE="$(api_code_get "$JAR_P" "$VIEW_PATH_3" "$TMP/answer-revoked.json")"; test "$REVOKED_VIEW_CODE" = '401'; jq -e '.error=="SESSION_INVALID"' "$TMP/answer-revoked.json" >/dev/null
echo 'P20 protected Answer Pack/Key lifecycle: PASS.'

# P25 is deliberately last: simultaneous active same-subject views must all remain Current.
d1 "INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES ('testy5e','P15_M3A','${TODAY}',NULL,'${NOW}','${NOW}');" "$TMP/multi-active-insert.json"
JAR="$TMP/multi-active.jar"; login_user testy5e "$JAR" "$TMP/multi-active-login.json"
api_get "$JAR" '/api/v1/student/home' "$TMP/multi-active-home.json"
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year3" and .current==true and .group=="current")' "$TMP/multi-active-home.json" >/dev/null
jq -e '.subjects[]|select(.subject=="maths")|.views[]|select(.viewId=="maths-year4" and .current==true and .group=="current")' "$TMP/multi-active-home.json" >/dev/null
echo 'P25 simultaneous active batches in one subject: PASS.'

echo 'Controlled persona matrix passed; restoring exact Phase 14 baseline.'
cleanup
MUTATION_STARTED=0

d1 "$BASE_SQL" "$TMP/after.json"
test "$(jq -r '.[0].results[0].entitlement_count' "$TMP/after.json")" = '632'
test "$(jq -r '.[1].results[0].batch_count' "$TMP/after.json")" = '4'
test "$(jq -r '.[2].results[0].assignment_count' "$TMP/after.json")" = '4'
test "$(jq -r '.[3].results[0].release_count' "$TMP/after.json")" = '0'
test "$(jq -r '.[4].results[0].assigned_users' "$TMP/after.json")" = '2'
test "$(jq -r '.[5].results[0].assigned_user_entitlements' "$TMP/after.json")" = '173'
for i in 6 7 8 9 10; do test "$(jq -r ".[$i].results[0] | to_entries[0].value" "$TMP/after.json")" = '0'; done
jq -e '.[11].results[0].name == "trg_student_sessions_single_active"' "$TMP/after.json" >/dev/null
jq -e '.[12].results[0].quick_check == "ok"' "$TMP/after.json" >/dev/null
for user in testy5e testy5em testy511e; do
  kv_get "$STUDENTS" "user:$user" "$TMP/restored-$user.json"
  diff -u <(jq -S . "$TMP/original-$user.json") <(jq -S . "$TMP/restored-$user.json") >/dev/null
done

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$TMP/settings-after.json"
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' "$TMP/settings-after.json" >/dev/null
test "$(jq -r '.result.bindings[]|select(.name=="MATERIALS_R2" and .type=="r2_bucket")|.bucket_name' "$TMP/settings-after.json")" = 'fpt-materials-dev'
AFTER_LOGIN="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' "$TMP/settings-after.json")"
case "${AFTER_LOGIN,,}" in ''|'false') ;; *) fail 'normal login changed during Phase 15';; esac

trap - EXIT
echo 'PHASE15_GUARDED_PERSONA_MATRIX_PASS: exact D1/KV baseline restored.'
