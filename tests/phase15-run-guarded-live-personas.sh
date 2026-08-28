#!/usr/bin/env bash
set -Eeuo pipefail

# Phase 15 deliberately changes controlled STUDENTS_KV values and then exercises
# the isolated Worker immediately. Workers KV is eventually consistent, so the
# harness must prove the intended value has reached the Worker edge before it
# treats a presentation result as authoritative. These retries are bounded and
# apply only to success-expected routes / controlled propagation probes; a
# persistent product defect still fails the matrix.
curl() {
  local arg previous='' target_url='' jar='' retryable=0 rc=0
  local tmp_out tmp_err attempt token hash ready probe_code probe_ready body joined

  for arg in "$@"; do
    if [ "$previous" = '--cookie-jar' ]; then jar="$arg"; fi
    case "$arg" in
      http://*|https://*) target_url="$arg" ;;
      */api/v1/student/views/*/lessons|*/api/v1/student/lessons/*\?viewId=*) retryable=1 ;;
    esac
    previous="$arg"
  done

  # P06 has two rapid KV transitions. The second login must project the exact
  # core-only value, not a stale Full Library / VR-bearing value. Validate the
  # fresh session projection by its token hash and retry login until it matches.
  if [ "${PHASE15_STAGE:-}" = 'p06-locked-list' ] && \
     [[ "$target_url" == */api/v1/student/auth/login ]] && \
     [ -n "${E4_VR_LESSON:-}" ] && [ -n "$jar" ]; then
    tmp_out="$(mktemp)"; tmp_err="$(mktemp)"
    for attempt in $(seq 1 20); do
      rc=0
      command /usr/bin/curl "$@" >"$tmp_out" 2>"$tmp_err" || rc=$?
      if [ "$rc" -ne 0 ]; then
        cat "$tmp_err" >&2; cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return "$rc"
      fi
      token="$(cookie_token "$jar")"
      if [ -n "$token" ]; then
        hash="$(token_hash "$token")"
        d1 "SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(json_extract(p.user_json,'$.manualAccess.coreLessons')) WHERE CAST(value AS TEXT)='${E4_VR_LESSON}') AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(p.user_json,'$.manualAccess.vrLessons')) WHERE CAST(value AS TEXT)='${E4_VR_LESSON}') AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(p.user_json,'$.fullLibraries')) WHERE CAST(value AS TEXT) IN ('ENGLISH_Y4_FULL','ENGLISH_Y4_11PLUS_FULL')) THEN 1 ELSE 0 END AS ready FROM student_session_profiles p WHERE p.token_hash='${hash}' LIMIT 1;" "$TMP/p06-wrapper-profile.json"
        ready="$(jq -r '.[0].results[0].ready // 0' "$TMP/p06-wrapper-profile.json")"
        if [ "$ready" = '1' ]; then
          cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return 0
        fi
      fi
      if [ "$attempt" -lt 20 ]; then sleep 2; fi
    done
    echo 'ERROR: P06 session projection did not observe the controlled core-only KV value in time.' >&2
    rm -f "$tmp_out" "$tmp_err"
    return 1
  fi

  # P20 changes only the controlled Answer Pack password and must prove an
  # already-issued viewer token is invalidated by that change. Before consuming
  # the old viewer token, use a throwaway authorization with the new password as
  # a non-destructive Worker-edge propagation probe. Any probe tokens and the
  # fresh-session rate-limit row are controlled fixtures and are cleaned/reset.
  if [ "${PHASE15_STAGE:-}" = 'p20-protected-answer' ] && \
     [ -n "${VIEW_PATH_2:-}" ] && [ -n "${ALT_ANSWER:-}" ] && \
     [ "$target_url" = "${WORKER_BASE}${VIEW_PATH_2}" ] && [ -n "$jar" ]; then
    probe_ready=0
    body="$(jq -cn --arg password "$ALT_ANSWER" '{password:$password}')"
    sleep 3
    for attempt in $(seq 1 5); do
      probe_code="$(command /usr/bin/curl --silent --show-error \
        --output "$TMP/p20-alt-probe.json" --write-out '%{http_code}' \
        --cookie "$jar" --cookie-jar "$jar" \
        --header "Origin: $ORIGIN" --header 'Accept: application/json' \
        --header 'Content-Type: application/json' --request POST --data "$body" \
        "$WORKER_BASE$AUTH_PATH")"
      if [ "$probe_code" = '200' ] && jq -e '.ok==true' "$TMP/p20-alt-probe.json" >/dev/null; then
        probe_ready=1
        break
      fi
      if [ "$probe_code" != '403' ] || ! jq -e '.error=="ANSWER_PASSWORD_INCORRECT"' "$TMP/p20-alt-probe.json" >/dev/null; then
        echo 'ERROR: P20 answer-password propagation probe returned an unexpected result.' >&2
        return 1
      fi
      if [ "$attempt" -lt 5 ]; then sleep 5; fi
    done
    if [ "$probe_ready" -ne 1 ]; then
      echo 'ERROR: P20 changed answer password did not reach the Worker edge in time.' >&2
      return 1
    fi

    token="$(cookie_token "$jar")"; hash="$(token_hash "$token")"
    d1 "DELETE FROM answer_password_rate_limits WHERE session_token_hash='${hash}';" "$TMP/p20-probe-rate-reset.json"
    command /usr/bin/curl "$@"
    return $?
  fi

  # After P20 restores the original password, the final authorization is also a
  # success-expected edge-read. Retry only an incorrect-password propagation
  # response; rate limiting or any other error remains a hard failure.
  joined="$*"
  if [ "${PHASE15_STAGE:-}" = 'p20-protected-answer' ] && \
     [ -n "${ALT_ANSWER:-}" ] && [ -n "${ANSWER_PASSWORD:-}" ] && \
     [[ "$target_url" == */answer/authorize\?viewId=* ]] && \
     [[ "$joined" == *"$ANSWER_PASSWORD"* ]]; then
    tmp_out="$(mktemp)"; tmp_err="$(mktemp)"
    for attempt in $(seq 1 5); do
      rc=0
      command /usr/bin/curl "$@" >"$tmp_out" 2>"$tmp_err" || rc=$?
      if [ "$rc" -eq 0 ]; then
        cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return 0
      fi
      if [ "$rc" -ne 22 ] || ! jq -e '.error=="ANSWER_PASSWORD_INCORRECT"' "$tmp_out" >/dev/null 2>&1; then
        cat "$tmp_err" >&2; cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return "$rc"
      fi
      if [ "$attempt" -lt 5 ]; then sleep 5; fi
    done
    cat "$tmp_err" >&2; cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return "$rc"
  fi

  if [ "$retryable" -ne 1 ]; then
    command /usr/bin/curl "$@"
    return $?
  fi

  tmp_out="$(mktemp)"; tmp_err="$(mktemp)"
  for attempt in $(seq 1 20); do
    rc=0
    command /usr/bin/curl "$@" >"$tmp_out" 2>"$tmp_err" || rc=$?
    if [ "$rc" -eq 0 ]; then
      cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return 0
    fi
    if [ "$rc" -ne 22 ]; then
      cat "$tmp_err" >&2; cat "$tmp_out"; rm -f "$tmp_out" "$tmp_err"; return "$rc"
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
