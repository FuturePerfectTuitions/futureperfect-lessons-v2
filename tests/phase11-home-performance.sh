#!/usr/bin/env bash
set -euo pipefail

WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN='https://futureperfecttuitions.github.io'
OUTPUT="${1:-/tmp/phase11-home-performance.json}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

login_with_transient_retry() {
  local user="$1"
  local jar="$2"
  local body="$3"
  local attempt http_code curl_rc

  for attempt in 1 2 3 4 5 6; do
    set +e
    http_code="$(curl --silent --show-error --cookie-jar "$jar" \
      --header "Origin: $ORIGIN" --header 'Content-Type: application/json' \
      --request POST --data "{\"username\":\"$user\",\"password\":\"Te12\"}" \
      --output "$body" --write-out '%{http_code}' \
      "$WORKER_BASE/api/v1/student/auth/login")"
    curl_rc=$?
    set -e

    if [ "$curl_rc" -eq 0 ] && [[ "$http_code" =~ ^2[0-9][0-9]$ ]] && jq -e '.ok == true' "$body" >/dev/null 2>&1; then
      return 0
    fi

    if [ "$curl_rc" -ne 0 ] || [[ "$http_code" =~ ^5[0-9][0-9]$ ]] || [ "$http_code" = '000' ]; then
      if [ "$attempt" -lt 6 ]; then
        echo "[$user] transient login failure (curl=$curl_rc http=$http_code); retrying ${attempt}/6." >&2
        sleep "$attempt"
        continue
      fi
    fi

    echo "[$user] login probe failed permanently (curl=$curl_rc http=$http_code)." >&2
    cat "$body" >&2 2>/dev/null || true
    return 1
  done

  return 1
}

printf '{"measurements":[' >"$OUTPUT"
first=1
for user in testy411m testy5em testy511e; do
  jar="$TMP/${user}.cookies"
  login_with_transient_retry "$user" "$jar" "$TMP/${user}.login.json"

  # Deliberately single-shot: this is the value being measured. Do not retry
  # /home or the timing would hide real latency/failure from the acceptance run.
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
