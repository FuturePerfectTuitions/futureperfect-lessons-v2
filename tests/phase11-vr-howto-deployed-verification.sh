#!/usr/bin/env bash
set -euo pipefail

WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN='https://futureperfecttuitions.github.io'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

login() {
  local user="$1"
  local jar="$TMP/${user}.cookies"
  curl --fail-with-body --silent --show-error --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
    --request POST --data "{\"username\":\"$user\",\"password\":\"Te12\"}" \
    "$WORKER_BASE/api/v1/student/auth/login" >"$TMP/${user}.login.json"
  jq -e '.ok == true' "$TMP/${user}.login.json" >/dev/null
}

ready=false
for attempt in $(seq 1 48); do
  rm -f "$TMP/TestY511E.cookies" "$TMP/detail.json"
  if login TestY511E 2>/dev/null; then
    status="$(curl --silent --show-error --output "$TMP/detail.json" --write-out '%{http_code}' \
      --cookie "$TMP/TestY511E.cookies" --header "Origin: $ORIGIN" \
      "$WORKER_BASE/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus" || true)"
    if [ "$status" = '200' ] && jq -e '
      .ok == true and
      .area.bucketId == "VR_HOWTO" and
      .area.title == "VR How To" and
      .accessSource == "open-english-11plus-view" and
      ([.area.items[] | select(.resourceKey != null)] | length > 0)
    ' "$TMP/detail.json" >/dev/null 2>&1; then
      ready=true
      break
    fi
  fi
  sleep 5
done

test "$ready" = true

# The legacy lesson-list special area must no longer expose VR_HOWTO: it is now
# a separate top-level English 11+ destination.
curl --fail-with-body --silent --show-error --cookie "$TMP/TestY511E.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/special-areas?viewId=english-year5-11plus" >"$TMP/list.json"
jq -e '.ok == true and ([.areas[]? | select(.bucketId == "VR_HOWTO")] | length == 0)' "$TMP/list.json" >/dev/null

# The ordinary Year 5 11+ lesson count stays ordinary; VR How To is not counted
# as a lesson merely because it is now visible beside the year card.
curl --fail-with-body --silent --show-error --cookie "$TMP/TestY511E.cookies" \
  --header "Origin: $ORIGIN" "$WORKER_BASE/api/v1/student/home" >"$TMP/home.json"
jq -e '
  .subjects[] | select(.subject == "english") | .views[] |
  select(.viewId == "english-year5-11plus") |
  .lockedPreview != true and .openLessonCount == 32
' "$TMP/home.json" >/dev/null

# At least one VR How To video must remain openable through the special-area route.
RESOURCE_KEY="$(jq -r '[.area.items[] | select(.resourceKey != null)][0].resourceKey // empty' "$TMP/detail.json")"
test -n "$RESOURCE_KEY"
curl --fail-with-body --silent --show-error --cookie "$TMP/TestY511E.cookies" \
  --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/special-resources/$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$RESOURCE_KEY")/video?viewId=english-year5-11plus" >"$TMP/video.json"
jq -e '.ok == true and .bucketId == "VR_HOWTO" and (.embedUrl | startswith("https://go.screenpal.com/player/"))' "$TMP/video.json" >/dev/null

# Normal English does not qualify.
login TestY5EM
normal_status="$(curl --silent --show-error --output "$TMP/normal.json" --write-out '%{http_code}' \
  --cookie "$TMP/TestY5EM.cookies" --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5")"
test "$normal_status" = '403'

# A cross-subject locked preview does not qualify either.
login TestY411M
preview_status="$(curl --silent --show-error --output "$TMP/preview.json" --write-out '%{http_code}' \
  --cookie "$TMP/TestY411M.cookies" --header "Origin: $ORIGIN" \
  "$WORKER_BASE/api/v1/student/special-areas/VR_HOWTO?viewId=english-year4-11plus")"
test "$preview_status" = '403'

echo 'Phase 11 deployed VR How To verification: PASS'
