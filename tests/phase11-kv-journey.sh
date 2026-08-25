#!/usr/bin/env bash
set -euo pipefail

WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN='https://futureperfecttuitions.github.io'
USER='testy5em'
PASSWORD='Te12'
ANSWER_PASSWORD='Te12'
VIEW_ID='maths-year5'
LESSON_ID='Y5M1'
OUT="${1:-/tmp/phase11-kv-journey.json}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies.txt"
STEPS="$TMP/steps.jsonl"
: >"$STEPS"

header_value(){
  local file="$1" name="$2"
  awk -v wanted="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN{IGNORECASE=1}
    {
      line=$0; sub(/\r$/, "", line);
      split(line, parts, ":");
      key=tolower(parts[1]);
      if(key==wanted){sub(/^[^:]*:[[:space:]]*/, "", line); value=line}
    }
    END{print value}
  ' "$file"
}

record_step(){
  local step="$1" headers="$2"
  local students lessons
  students="$(header_value "$headers" 'X-FPT-Students-KV-Read-Ops')"
  lessons="$(header_value "$headers" 'X-FPT-Lessons-KV-Read-Ops')"
  test -n "$students"
  test -n "$lessons"
  echo "KV journey ${step}: students=${students} lessons=${lessons}"
  jq -cn --arg step "$step" --argjson students "$students" --argjson lessons "$lessons" \
    '{step:$step,studentsKvReadOps:$students,lessonsKvReadOps:$lessons,totalKvReadOps:($students+$lessons)}' >>"$STEPS"
}

require_http_success(){
  local step="$1" status="$2" body_file="$3"
  echo "KV journey ${step}: HTTP ${status}"
  case "$status" in
    2??) return 0 ;;
  esac
  echo "KV journey ${step} failed; response prefix follows:" >&2
  if [ -f "$body_file" ]; then head -c 1000 "$body_file" >&2 || true; echo >&2; fi
  return 22
}

# 1. Login — the one authoritative ordinary student-record KV read.
status="$(curl --silent --show-error \
  --dump-header "$TMP/login.h" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
  --request POST --data "{\"username\":\"$USER\",\"password\":\"$PASSWORD\"}" \
  --output "$TMP/login.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/auth/login")"
require_http_success login "$status" "$TMP/login.json"
jq -e '.ok == true and .portalUserId == "testy5em"' "$TMP/login.json" >/dev/null
record_step login "$TMP/login.h"

# 2. Home.
status="$(curl --silent --show-error \
  --dump-header "$TMP/home.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/json' \
  --output "$TMP/home.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/home")"
require_http_success home "$status" "$TMP/home.json"
jq -e '.ok == true' "$TMP/home.json" >/dev/null
record_step home "$TMP/home.h"

# 3. Subject selection is frontend-local: /home already contains the Maths/English
# subject model, so selecting Maths causes no Worker/KV operation.
echo 'KV journey subject: frontend-local, students=0 lessons=0'
jq -cn '{step:"subject",studentsKvReadOps:0,lessonsKvReadOps:0,totalKvReadOps:0}' >>"$STEPS"

# 4. Year/Level lesson list.
status="$(curl --silent --show-error \
  --dump-header "$TMP/list.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/json' \
  --output "$TMP/list.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/views/$VIEW_ID/lessons")"
require_http_success yearLevel "$status" "$TMP/list.json"
jq -e --arg lesson "$LESSON_ID" '.ok == true and any(.lessons[]; .lessonId==$lesson and .locked==false)' "$TMP/list.json" >/dev/null
record_step yearLevel "$TMP/list.h"

# 5. Lesson detail.
status="$(curl --silent --show-error \
  --dump-header "$TMP/detail.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/json' \
  --output "$TMP/detail.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/lessons/$LESSON_ID?viewId=$VIEW_ID")"
require_http_success lesson "$status" "$TMP/detail.json"
jq -e '.ok == true and .lesson.lessonId == "Y5M1" and .lesson.locked == false' "$TMP/detail.json" >/dev/null
VIDEO_KEY="$(jq -r '.lesson.video.resourceKey // empty' "$TMP/detail.json")"
HOMEWORK_KEY="$(jq -r '[.lesson.homeworks[]?.homework | select(.available != false) | .resourceKey // empty] | map(select(length>0)) | .[0] // empty' "$TMP/detail.json")"
ANSWER_KEY="$(jq -r '[.lesson.homeworks[]?.answerPack | select(.available != false) | .resourceKey // empty] | map(select(length>0)) | .[0] // empty' "$TMP/detail.json")"
test -n "$VIDEO_KEY"
test -n "$HOMEWORK_KEY"
test -n "$ANSWER_KEY"
echo "KV journey lesson keys: video=${VIDEO_KEY} homework=${HOMEWORK_KEY} answer=${ANSWER_KEY}"
record_step lesson "$TMP/detail.h"

# 6. Lesson Video.
status="$(curl --silent --show-error \
  --dump-header "$TMP/video.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/json' \
  --output "$TMP/video.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/resources/$VIDEO_KEY/video?viewId=$VIEW_ID")"
require_http_success video "$status" "$TMP/video.json"
jq -e '.ok == true and (.embedUrl|startswith("https://go.screenpal.com/player/"))' "$TMP/video.json" >/dev/null
record_step video "$TMP/video.h"

# 7. Homework download.
status="$(curl --silent --show-error \
  --dump-header "$TMP/homework.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" \
  --output "$TMP/homework.bin" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/resources/$HOMEWORK_KEY?viewId=$VIEW_ID")"
require_http_success homework "$status" "$TMP/homework.bin"
test -s "$TMP/homework.bin"
record_step homework "$TMP/homework.h"

# 8a. Answer Pack password authorization. These live student-record reads are
# intentional because the current Answer Pack password must invalidate access.
status="$(curl --silent --show-error \
  --dump-header "$TMP/answer-auth.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
  --request POST --data "{\"password\":\"$ANSWER_PASSWORD\"}" \
  --output "$TMP/answer-auth.json" --write-out '%{http_code}' \
  "$WORKER_BASE/api/v1/student/resources/$ANSWER_KEY/answer/authorize?viewId=$VIEW_ID")"
require_http_success answerPackAuthorize "$status" "$TMP/answer-auth.json"
jq -e '.ok == true and (.viewerPath|startswith("/api/v1/student/answer-view/"))' "$TMP/answer-auth.json" >/dev/null
VIEWER_PATH="$(jq -r '.viewerPath' "$TMP/answer-auth.json")"
record_step answerPackAuthorize "$TMP/answer-auth.h"

# 8b. Consume the protected Answer Pack once, matching the real viewer open.
status="$(curl --silent --show-error \
  --dump-header "$TMP/answer-view.h" --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/pdf,application/octet-stream' \
  --output "$TMP/answer.bin" --write-out '%{http_code}' \
  "$WORKER_BASE$VIEWER_PATH")"
require_http_success answerPackOpen "$status" "$TMP/answer.bin"
test -s "$TMP/answer.bin"
record_step answerPackOpen "$TMP/answer-view.h"

jq -s '
  {
    persona:"TestY5EM",
    journey:"login → home → subject → Year/Level → lesson → video → homework → Answer Pack",
    steps:.,
    totals:{
      studentsKvReadOps:(map(.studentsKvReadOps)|add),
      lessonsKvReadOps:(map(.lessonsKvReadOps)|add),
      totalKvReadOps:(map(.totalKvReadOps)|add)
    }
  }
' "$STEPS" >"$OUT"

cat "$OUT"
