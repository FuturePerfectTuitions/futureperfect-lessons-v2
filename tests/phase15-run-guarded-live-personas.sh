#!/usr/bin/env bash
set -Eeuo pipefail

# The controlled Phase 15 personas temporarily mutate STUDENTS_KV and then
# immediately exercise the affected lesson-list/detail routes. Cloudflare KV is
# eventually consistent across requests/PoPs, so a just-granted Full Library or
# manual-access source can briefly produce a 404 even after authoritative KV
# readback and /home already show the new view. Retry only success-expected
# student lesson list/detail GETs, only for curl's HTTP-failure exit (22), and
# keep the window bounded. A persistent product defect still fails the matrix.
curl() {
  local arg retryable=0 rc=0 tmp_out tmp_err attempt
  for arg in "$@"; do
    case "$arg" in
      */api/v1/student/views/*/lessons|*/api/v1/student/lessons/*\?viewId=*)
        retryable=1
        ;;
    esac
  done

  if [ "$retryable" -ne 1 ]; then
    command /usr/bin/curl "$@"
    return $?
  fi

  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"
  for attempt in $(seq 1 20); do
    if command /usr/bin/curl "$@" >"$tmp_out" 2>"$tmp_err"; then
      cat "$tmp_out"
      rm -f "$tmp_out" "$tmp_err"
      return 0
    fi
    rc=$?
    if [ "$rc" -ne 22 ]; then
      cat "$tmp_err" >&2
      cat "$tmp_out"
      rm -f "$tmp_out" "$tmp_err"
      return "$rc"
    fi
    if [ "$attempt" -lt 20 ]; then sleep 2; fi
  done

  cat "$tmp_err" >&2
  cat "$tmp_out"
  rm -f "$tmp_out" "$tmp_err"
  return "$rc"
}
export -f curl

exec bash tests/phase15-guarded-live-personas.sh
