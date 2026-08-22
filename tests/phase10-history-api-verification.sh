#!/usr/bin/env bash
set -euo pipefail
WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN="https://futureperfecttuitions.github.io"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies"

curl --fail-with-body --silent --show-error --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
  --request POST --data '{"username":"test0707","password":"H7st"}' \
  "$WORKER_BASE/api/v1/student/auth/login" > "$TMP/login.json"
jq -e '.ok == true' "$TMP/login.json" >/dev/null

curl --fail-with-body --silent --show-error --cookie "$JAR" --cookie-jar "$JAR" \
  --header "Origin: $ORIGIN" --header 'Accept: application/json' \
  "$WORKER_BASE/api/v1/student/home" > "$TMP/home.json"

jq -e '.ok == true and .student.portalUserId == "test0707"' "$TMP/home.json" >/dev/null
jq -e '[.subjects[] | select(.subject=="maths") | .views[] | {label,group}] == [
  {"label":"Year 3","group":"previous"},
  {"label":"Year 4","group":"previous"},
  {"label":"Year 5","group":"current"}
]' "$TMP/home.json" >/dev/null
jq -e '[.subjects[] | select(.subject=="english") | .views[] | {label,group}] == [
  {"label":"Year 4","group":"previous"},
  {"label":"Year 5","group":"current"}
]' "$TMP/home.json" >/dev/null
jq -e '([.subjects[] | select(.subject=="english") | .views[].label] | index("Year 3")) == null' "$TMP/home.json" >/dev/null

echo 'Phase 10 multi-year history API acceptance: PASS'
