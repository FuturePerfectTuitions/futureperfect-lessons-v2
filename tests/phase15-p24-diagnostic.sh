#!/usr/bin/env bash
set -Eeuo pipefail

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${WORKER_NAME:=fpt-portal-v2-worker}"
: "${WORKER_BASE:=https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
: "${WRANGLER_VERSION:=4.125.0}"

W="npx --yes wrangler@${WRANGLER_VERSION}"
ORIGIN='https://futureperfecttuitions.github.io'
USER='testy5e'
START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
TMP="$(mktemp -d)"
STUDENTS=''
LESSONS=''
BACKED_UP=0

mask(){ [ -z "${1:-}" ] || echo "::add-mask::$1"; }
urlenc(){ node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
kv_url(){ printf 'https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s' "$CLOUDFLARE_ACCOUNT_ID" "$1" "$(urlenc "$2")"; }
kv_get(){ curl --fail --silent --show-error "$(kv_url "$1" "$2")" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$3"; }
kv_put(){ curl --fail --silent --show-error --request PUT "$(kv_url "$1" "$2")" --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --header 'Content-Type: application/json' --data-binary "@$3" >/dev/null; }
d1(){ $W d1 execute fpt_portal_v2_db --remote --json --command "$1" >"$2" 2>"$2.err"; }

restore(){
  local rc=0
  set +e
  if [ "$BACKED_UP" -eq 1 ]; then
    kv_put "$STUDENTS" "user:$USER" "$TMP/original.json" || rc=1
    for attempt in $(seq 1 12); do
      kv_get "$STUDENTS" "user:$USER" "$TMP/restored.json" || { sleep 2; continue; }
      if diff -u <(jq -S . "$TMP/original.json") <(jq -S . "$TMP/restored.json") >/dev/null; then break; fi
      sleep 2
    done
    diff -u <(jq -S . "$TMP/original.json") <(jq -S . "$TMP/restored.json") >/dev/null || rc=1
  fi
  d1 "DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm='${USER}' AND created_at >= '${START}'); DELETE FROM answer_view_tokens WHERE portal_user_id_norm='${USER}' AND created_at >= '${START}'; DELETE FROM student_session_profiles WHERE portal_user_id_norm='${USER}' AND created_at >= '${START}'; DELETE FROM student_sessions WHERE portal_user_id_norm='${USER}' AND created_at >= '${START}';" "$TMP/session-clean.json" || rc=1
  set -e
  return "$rc"
}

on_exit(){
  local status=$?
  trap - EXIT
  restore || status=97
  exit "$status"
}
trap on_exit EXIT

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/settings" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --output "$TMP/settings.json"
jq -e '.success == true' "$TMP/settings.json" >/dev/null
jq -e '.result.bindings[]|select(.name=="ENVIRONMENT" and .type=="plain_text" and .text=="development")' "$TMP/settings.json" >/dev/null
LOGIN="$(jq -r '[.result.bindings[]|select(.name=="STUDENT_LOGIN_ENABLED" and .type=="plain_text")|.text][0] // ""' "$TMP/settings.json")"
case "${LOGIN,,}" in ''|'false') ;; *) exit 1;; esac
STUDENTS="$(jq -r '.result.bindings[]|select(.name=="STUDENTS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings.json")"
LESSONS="$(jq -r '.result.bindings[]|select(.name=="LESSONS_KV" and .type=="kv_namespace")|.namespace_id' "$TMP/settings.json")"
test -n "$STUDENTS"; test -n "$LESSONS"

# Exact accepted D1 baseline before the read/write diagnostic.
d1 "SELECT COUNT(*) AS e FROM lesson_entitlements; SELECT COUNT(*) AS b FROM batch_definitions; SELECT COUNT(*) AS a FROM student_batch_assignments; SELECT COUNT(*) AS r FROM batch_lesson_releases;" "$TMP/baseline.json"
test "$(jq -r '.[0].results[0].e' "$TMP/baseline.json")" = '632'
test "$(jq -r '.[1].results[0].b' "$TMP/baseline.json")" = '4'
test "$(jq -r '.[2].results[0].a' "$TMP/baseline.json")" = '4'
test "$(jq -r '.[3].results[0].r' "$TMP/baseline.json")" = '0'

kv_get "$STUDENTS" "user:$USER" "$TMP/original.json"
BACKED_UP=1
PASSWORD="$(jq -r '.p // empty' "$TMP/original.json")"
test -n "$PASSWORD"; mask "$PASSWORD"

kv_get "$LESSONS" 'curriculum:ENGLISH_Y4' "$TMP/curriculum.json"
d1 "SELECT lesson_id FROM lesson_entitlements WHERE portal_user_id_norm='${USER}';" "$TMP/existing.json"
LESSON="$(node - "$TMP/curriculum.json" "$TMP/original.json" "$TMP/existing.json" <<'NODE'
const fs=require('node:fs');
const curriculum=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const user=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const existing=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
const raw=Array.isArray(curriculum)?curriculum:(curriculum.lessonIds||curriculum.lessons||curriculum.items||[]);
const ids=raw.map(x=>typeof x==='string'?x:x?.lessonId).filter(Boolean);
const manual=new Set((user.manualAccess?.coreLessons||[]).map(String));
const earned=new Set((existing[0]?.results||[]).map(x=>String(x.lesson_id||'')));
const candidate=ids.find(id=>!manual.has(String(id))&&!earned.has(String(id)));
if(candidate) process.stdout.write(String(candidate));
NODE
)"
test -n "$LESSON"; mask "$LESSON"

jq --arg id "$LESSON" '.manualAccess.coreLessons=((.manualAccess.coreLessons // []) + [$id] | unique)' "$TMP/original.json" >"$TMP/manual.json"
kv_put "$STUDENTS" "user:$USER" "$TMP/manual.json"

PROPAGATED=0
for attempt in $(seq 1 12); do
  kv_get "$STUDENTS" "user:$USER" "$TMP/readback.json"
  if jq -e --arg id "$LESSON" '((.manualAccess.coreLessons // []) | index($id)) != null' "$TMP/readback.json" >/dev/null; then PROPAGATED=1; break; fi
  sleep 2
done
echo "PHASE15_P24_DIAG kv_propagated=${PROPAGATED}"
test "$PROPAGATED" = '1'

JAR="$TMP/cookies.txt"
PAYLOAD="$(jq -cn --arg username "$USER" --arg password "$PASSWORD" '{username:$username,password:$password}')"
curl --fail-with-body --silent --show-error --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' --header 'Accept: application/json' \
  --request POST --data "$PAYLOAD" "$WORKER_BASE/api/v1/student/auth/login" >"$TMP/login.json"
jq -e '.ok == true' "$TMP/login.json" >/dev/null

HOME_CODE=''; HOME_VIEW='0'; LIST_CODE=''; OPEN='0'
for attempt in $(seq 1 8); do
  HOME_CODE="$(curl --silent --show-error --output "$TMP/home.json" --write-out '%{http_code}' --cookie "$JAR" --cookie-jar "$JAR" --header "Origin: $ORIGIN" --header 'Accept: application/json' "$WORKER_BASE/api/v1/student/home")"
  if [ "$HOME_CODE" = '200' ] && jq -e '.subjects[]|select(.subject=="english")|.views[]|select(.viewId=="english-year4")' "$TMP/home.json" >/dev/null; then HOME_VIEW='1'; fi
  LIST_CODE="$(curl --silent --show-error --output "$TMP/list.json" --write-out '%{http_code}' --cookie "$JAR" --cookie-jar "$JAR" --header "Origin: $ORIGIN" --header 'Accept: application/json' "$WORKER_BASE/api/v1/student/views/english-year4/lessons")"
  if [ "$LIST_CODE" = '200' ] && jq -e --arg id "$LESSON" '.lessons[]|select(.lessonId==$id and .locked==false)' "$TMP/list.json" >/dev/null; then OPEN='1'; break; fi
  sleep 2
done
echo "PHASE15_P24_DIAG home_status=${HOME_CODE} home_view=${HOME_VIEW} list_status=${LIST_CODE} lesson_open=${OPEN}"
test "$HOME_CODE" = '200'; test "$HOME_VIEW" = '1'; test "$LIST_CODE" = '200'; test "$OPEN" = '1'

d1 "SELECT COUNT(*) AS a FROM student_batch_assignments WHERE portal_user_id_norm='${USER}'; SELECT COUNT(*) AS e FROM lesson_entitlements WHERE portal_user_id_norm='${USER}' AND lesson_id='${LESSON}'; SELECT COUNT(*) AS r FROM batch_lesson_releases WHERE lesson_id='${LESSON}';" "$TMP/no-membership.json"
test "$(jq -r '.[0].results[0].a' "$TMP/no-membership.json")" = '0'
test "$(jq -r '.[1].results[0].e' "$TMP/no-membership.json")" = '0'
test "$(jq -r '.[2].results[0].r' "$TMP/no-membership.json")" = '0'
echo 'PHASE15_P24_DIAGNOSTIC_PASS'
