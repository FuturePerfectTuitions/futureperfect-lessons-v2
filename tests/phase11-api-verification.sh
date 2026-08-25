#!/usr/bin/env bash
set -euo pipefail
WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN='https://futureperfecttuitions.github.io'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

login(){
  local user="$1"
  local jar="$TMP/${user}.cookies"
  curl --fail-with-body --silent --show-error --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
    --request POST --data "{\"username\":\"$user\",\"password\":\"Te12\"}" \
    "$WORKER_BASE/api/v1/student/auth/login" >"$TMP/${user}.login.json"
  jq -e --arg u "$user" '.ok == true and .portalUserId == ($u|ascii_downcase)' "$TMP/${user}.login.json" >/dev/null
}

home(){
  local user="$1"
  curl --fail-with-body --silent --show-error --cookie "$TMP/${user}.cookies" --cookie-jar "$TMP/${user}.cookies" \
    --header "Origin: $ORIGIN" --header 'Accept: application/json' \
    "$WORKER_BASE/api/v1/student/home" >"$TMP/${user}.home.json"
  jq -e '.ok == true' "$TMP/${user}.home.json" >/dev/null
}

assert_open_view(){
  local user="$1" subject="$2" view="$3" count="$4"
  jq -e --arg s "$subject" --arg v "$view" --argjson c "$count" '
    .subjects[] | select(.subject==$s) | .views[] | select(.viewId==$v) |
    .lockedPreview != true and .group == "current" and .openLessonCount == $c
  ' "$TMP/${user}.home.json" >/dev/null
}

assert_locked_view(){
  local user="$1" subject="$2" view="$3"
  jq -e --arg s "$subject" --arg v "$view" '
    .subjects[] | select(.subject==$s) | .views[] | select(.viewId==$v) | .lockedPreview == true
  ' "$TMP/${user}.home.json" >/dev/null
}

for user in testy2e testy2m testy2em testy4em testy411m testy511e testy5em testy5e testy511em; do
  login "$user"
  home "$user"
done

assert_open_view testy2e english english-year2 29
assert_locked_view testy2e maths maths-year2
assert_open_view testy2m maths maths-year2 36
assert_locked_view testy2m english english-year2
assert_open_view testy2em english english-year2 29
assert_open_view testy2em maths maths-year2 36
assert_open_view testy4em english english-year4 34
assert_open_view testy4em maths maths-year4 36
assert_open_view testy411m maths maths-level2 38
assert_locked_view testy411m english english-year4-11plus
assert_open_view testy511e english english-year5-11plus 32
assert_locked_view testy511e maths maths-year5
assert_open_view testy5em english english-year5 32
assert_open_view testy5em maths maths-year5 38
assert_open_view testy5e english english-year5 32
assert_locked_view testy5e maths maths-year5
assert_open_view testy511em english english-year5-11plus 32
assert_open_view testy511em maths maths-level3 43

curl --fail-with-body --silent --show-error --cookie "$TMP/testy5em.cookies" \
  --header "Origin: $ORIGIN" "$WORKER_BASE/api/v1/student/views/maths-year5/lessons" >"$TMP/y5normal.json"
curl --fail-with-body --silent --show-error --cookie "$TMP/testy411m.cookies" \
  --header "Origin: $ORIGIN" "$WORKER_BASE/api/v1/student/views/maths-level2/lessons" >"$TMP/y4eleven.json"
jq -e '.lessons[] | select(.lessonId=="Y5M1") | .displayLessonId == "Y5T1M01" and .locked == false' "$TMP/y5normal.json" >/dev/null
jq -e '.lessons[] | select(.lessonId=="Y5M1") | .displayLessonId == "L2T1M01" and .locked == false' "$TMP/y4eleven.json" >/dev/null

# Owner rule: quiz is the interactive 11+ variant of Lesson Video, never a second frontend resource.
curl --fail-with-body --silent --show-error --cookie "$TMP/testy5em.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/lessons/Y5M1?viewId=maths-year5" >"$TMP/normal-detail.json"
curl --fail-with-body --silent --show-error --cookie "$TMP/testy411m.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/lessons/Y5M1?viewId=maths-level2" >"$TMP/eleven-detail.json"
jq -e '.ok == true and .lesson.presentation == "normal" and .lesson.video != null and .lesson.quiz == null' "$TMP/normal-detail.json" >/dev/null
jq -e '.ok == true and .lesson.presentation == "11plus" and .lesson.video.resourceKey == "Y5M1~video~1" and .lesson.quiz == null' "$TMP/eleven-detail.json" >/dev/null

# Normal Year 5 Maths must present the Year 5 code on every visible resource name,
# while the shared 11+ Level 2 view must retain its L2 code.
jq -e '[.. | objects | .displayName? // empty | strings | select(test("L2T[0-9]+M[0-9]+"))] | length == 0' "$TMP/normal-detail.json" >/dev/null
jq -e '.lesson.preLessonSheets[0].displayName | contains("Y5T1M01")' "$TMP/normal-detail.json" >/dev/null
jq -e '.lesson.homeworks[0].homework.displayName | contains("Y5T1M01")' "$TMP/normal-detail.json" >/dev/null
jq -e '.lesson.homeworks[0].answerPack.displayName | contains("Y5T1M01")' "$TMP/normal-detail.json" >/dev/null
jq -e '.lesson.preLessonSheets[0].displayName | contains("L2T1M01")' "$TMP/eleven-detail.json" >/dev/null
jq -e '.lesson.homeworks[0].homework.displayName | contains("L2T1M01")' "$TMP/eleven-detail.json" >/dev/null

ANSWER_KEY="$(jq -r '.lesson.homeworks[0].answerPack.resourceKey // empty' "$TMP/normal-detail.json")"
test -n "$ANSWER_KEY"
curl --fail-with-body --silent --show-error --cookie "$TMP/testy5em.cookies" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
  --request POST --data '{"password":"Te12"}' \
  "$WORKER_BASE/api/v1/student/resources/$ANSWER_KEY/answer/authorize?viewId=maths-year5" >"$TMP/normal-answer-authorize.json"
jq -e '.ok == true and (.displayName | contains("Y5T1M01")) and ((.displayName | contains("L2T1M01")) | not)' "$TMP/normal-answer-authorize.json" >/dev/null

# The internal quiz route stays gated, but it is no longer presented as a separate frontend section.
normal_status="$(curl --silent --show-error --output "$TMP/normal-quiz.json" --write-out '%{http_code}' \
  --cookie "$TMP/testy5em.cookies" --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/resources/Y5M1~quiz~1/quiz?viewId=maths-year5")"
test "$normal_status" = '403'
jq -e '.error == "QUIZ_NOT_AVAILABLE"' "$TMP/normal-quiz.json" >/dev/null
curl --fail-with-body --silent --show-error --cookie "$TMP/testy411m.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/resources/Y5M1~quiz~1/quiz?viewId=maths-level2" >"$TMP/eleven-quiz.json"
jq -e '.ok == true and (.url|contains("quiz_id="))' "$TMP/eleven-quiz.json" >/dev/null

pending_status="$(curl --silent --show-error --output "$TMP/pending-video.json" --write-out '%{http_code}' \
  --cookie "$TMP/testy2e.cookies" --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/resources/Y2E1~video~1/video?viewId=english-year2")"
test "$pending_status" = '409'
jq -e '.error == "VIDEO_URL_REQUIRED"' "$TMP/pending-video.json" >/dev/null

# The same /video frontend concept resolves differently by presentation.
curl --fail-with-body --silent --show-error --cookie "$TMP/testy5em.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-year5" >"$TMP/normal-video.json"
curl --fail-with-body --silent --show-error --cookie "$TMP/testy411m.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-level2" >"$TMP/eleven-video.json"
jq -e '.ok == true and (.embedUrl|startswith("https://go.screenpal.com/player/")) and ((.embedUrl|contains("quiz_id="))|not)' "$TMP/normal-video.json" >/dev/null
jq -e '.ok == true and (.embedUrl|startswith("https://go.screenpal.com/player/")) and (.embedUrl|contains("quiz_id="))' "$TMP/eleven-video.json" >/dev/null

HIST_JAR="$TMP/test0707.cookies"
curl --fail-with-body --silent --show-error --cookie-jar "$HIST_JAR" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
  --request POST --data '{"username":"test0707","password":"H7st"}' \
  "$WORKER_BASE/api/v1/student/auth/login" >/dev/null
curl --fail-with-body --silent --show-error --cookie "$HIST_JAR" \
  --header "Origin: $ORIGIN" "$WORKER_BASE/api/v1/student/home" >"$TMP/history-home.json"
jq -e '[.subjects[] | select(.subject=="maths") | .views[] | {label,group}] == [
  {"label":"Year 3","group":"previous"},{"label":"Year 4","group":"previous"},{"label":"Year 5","group":"current"}
]' "$TMP/history-home.json" >/dev/null
jq -e '[.subjects[] | select(.subject=="english") | .views[] | {label,group}] == [
  {"label":"Year 4","group":"previous"},{"label":"Year 5","group":"current"}
]' "$TMP/history-home.json" >/dev/null

echo 'Phase 11 deployed API acceptance: PASS'