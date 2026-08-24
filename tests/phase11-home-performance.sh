#!/usr/bin/env bash
set -euo pipefail

WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN='https://futureperfecttuitions.github.io'
OUTPUT="${1:-/tmp/phase11-home-performance.json}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf '{"measurements":[' >"$OUTPUT"
first=1
for user in testy411m testy5em testy511e; do
  jar="$TMP/${user}.cookies"
  curl --fail-with-body --silent --show-error --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
    --request POST --data "{\"username\":\"$user\",\"password\":\"Te12\"}" \
    "$WORKER_BASE/api/v1/student/auth/login" >"$TMP/${user}.login.json"
  jq -e '.ok == true' "$TMP/${user}.login.json" >/dev/null

  seconds="$(curl --fail-with-body --silent --show-error \
    --cookie "$jar" --cookie-jar "$jar" \
    --header "Origin: $ORIGIN" --header 'Accept: application/json' \
    --output "$TMP/${user}.home.json" --write-out '%{time_total}' \
    "$WORKER_BASE/api/v1/student/home")"
  jq -e '.ok == true' "$TMP/${user}.home.json" >/dev/null
  ms="$(awk -v s="$seconds" 'BEGIN { printf "%.1f", s * 1000 }')"

  if [ "$first" -eq 0 ]; then printf ',' >>"$OUTPUT"; fi
  first=0
  printf '{"persona":"%s","homeMs":%s}' "$user" "$ms" >>"$OUTPUT"
done
printf ']}' >>"$OUTPUT"

echo
cat "$OUTPUT"
echo
