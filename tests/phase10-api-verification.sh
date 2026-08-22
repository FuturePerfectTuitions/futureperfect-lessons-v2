#!/usr/bin/env bash
set -euo pipefail
: "${PHASE10_TEST_MOCK_PASSWORD:?PHASE10_TEST_MOCK_PASSWORD is required}"
WORKER_BASE="${WORKER_BASE:-https://fpt-portal-v2-worker.futureperfectlessons.workers.dev}"
ORIGIN="https://futureperfecttuitions.github.io"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

api_get(){ local jar="$1" path="$2" out="$3"; curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' "$WORKER_BASE$path" > "$out"; }
api_post(){ local jar="$1" path="$2" body="$3" out="$4"; curl --fail-with-body --silent --show-error --cookie "$jar" --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Accept: application/json' --header 'Content-Type: application/json' --request POST --data "$body" "$WORKER_BASE$path" > "$out"; }
login(){ local user="$1" password="$2" jar="$3"; curl --fail-with-body --silent --show-error --cookie-jar "$jar" --header "Origin: $ORIGIN" --header 'Content-Type: application/json' --request POST --data "{\"username\":\"$user\",\"password\":\"$password\"}" "$WORKER_BASE/api/v1/student/auth/login" > "$TMP/login-$user.json"; jq -e '.ok == true' "$TMP/login-$user.json" >/dev/null; }
assert_no_locked_refs(){ local file="$1"; jq -e '([.. | objects | keys[]] | all(. != "screenpal" and . != "sp" and . != "embedUrl" and . != "resourceKey" and . != "url"))' "$file" >/dev/null; }

JAR5="$TMP/test0505.cookies"
login test0505 M5ok "$JAR5"
api_get "$JAR5" '/api/v1/student/home' "$TMP/home5.json"
jq -e '.subjects[] | select(.subject=="maths") | .views[] | select(.viewId=="maths-level3")' "$TMP/home5.json" >/dev/null
jq -e '.subjects[] | select(.subject=="english") | .views[] | select(.viewId=="english-year5-11plus")' "$TMP/home5.json" >/dev/null

api_get "$JAR5" '/api/v1/student/special-areas?viewId=maths-level3' "$TMP/y5maths-special.json"
jq -e '[.areas[].bucketId] | sort == ["MOCKS","Y5MAssT1","Y5MAssT2"]' "$TMP/y5maths-special.json" >/dev/null
jq -e '.source == "manualAccess.specialBuckets" and .excelEntitlementsUsed == false' "$TMP/y5maths-special.json" >/dev/null
api_get "$JAR5" '/api/v1/student/special-areas?viewId=english-year5-11plus' "$TMP/y5english-special.json"
jq -e '[.areas[].bucketId] | sort == ["MOCKS","VR_HOWTO"]' "$TMP/y5english-special.json" >/dev/null

api_get "$JAR5" '/api/v1/student/special-areas/MOCKS?viewId=maths-level3' "$TMP/mock-locked.json"
jq -e '.area.passwordProtected == true and .area.passwordScope == "mock-day-browser-session"' "$TMP/mock-locked.json" >/dev/null
jq -e '.area.days[0].day == 1 and ([.area.days[0].videos[].subject] | sort == ["maths","vr"])' "$TMP/mock-locked.json" >/dev/null
assert_no_locked_refs "$TMP/mock-locked.json"

BAD_CODE="$(curl --silent --show-error --output "$TMP/mock-bad.json" --write-out '%{http_code}' --cookie "$JAR5" --cookie-jar "$JAR5" --header "Origin: $ORIGIN" --header 'Content-Type: application/json' --request POST --data '{"password":"definitely-wrong"}' "$WORKER_BASE/api/v1/student/special-areas/MOCKS/mock-days/1/unlock?viewId=maths-level3")"
test "$BAD_CODE" = "403"
jq -e '.error == "MOCK_PASSWORD_INCORRECT"' "$TMP/mock-bad.json" >/dev/null
assert_no_locked_refs "$TMP/mock-bad.json"

api_post "$JAR5" '/api/v1/student/special-areas/MOCKS/mock-days/1/unlock?viewId=maths-level3' "$(jq -cn --arg password "$PHASE10_TEST_MOCK_PASSWORD" '{password:$password}')" "$TMP/mock-good.json"
jq -e '.ok == true and .unlockScope == "browser-session" and (.videos | length) == 2' "$TMP/mock-good.json" >/dev/null
jq -e '[.videos[].subject] | sort == ["maths","vr"]' "$TMP/mock-good.json" >/dev/null
jq -e 'all(.videos[]; (.embedUrl | startswith("https://go.screenpal.com/player/")))' "$TMP/mock-good.json" >/dev/null

api_get "$JAR5" '/api/v1/student/special-areas/Y5MAssT1?viewId=maths-level3' "$TMP/assessment.json"
ASSESS_KEY="$(jq -r '.area.items[] | select(.separator==false) | .resourceKey' "$TMP/assessment.json" | head -n1)"
test -n "$ASSESS_KEY" && test "$ASSESS_KEY" != "null"
ENC_ASSESS_KEY="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$ASSESS_KEY")"
api_get "$JAR5" "/api/v1/student/special-resources/$ENC_ASSESS_KEY/video?viewId=maths-level3" "$TMP/assessment-video.json"
jq -e '.ok == true and (.embedUrl | startswith("https://go.screenpal.com/player/"))' "$TMP/assessment-video.json" >/dev/null

api_get "$JAR5" '/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus' "$TMP/vr-howto.json"
VR_KEY="$(jq -r '.area.items[] | select(.separator==false) | .resourceKey' "$TMP/vr-howto.json" | head -n1)"
ENC_VR_KEY="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$VR_KEY")"
api_get "$JAR5" "/api/v1/student/special-resources/$ENC_VR_KEY/video?viewId=english-year5-11plus" "$TMP/vr-video.json"
jq -e '.ok == true and (.embedUrl | startswith("https://go.screenpal.com/player/"))' "$TMP/vr-video.json" >/dev/null

JAR4="$TMP/test0606.cookies"
login test0606 Y4ok "$JAR4"
api_get "$JAR4" '/api/v1/student/special-areas?viewId=maths-level2' "$TMP/y4maths-special.json"
jq -e '[.areas[].bucketId] | sort == ["Y4MAssT1","Y4MAssT2"]' "$TMP/y4maths-special.json" >/dev/null
api_get "$JAR4" '/api/v1/student/special-areas?viewId=english-year4-11plus' "$TMP/y4english-special.json"
jq -e '[.areas[].bucketId] == ["VR_HOWTO"]' "$TMP/y4english-special.json" >/dev/null

JAR0="$TMP/test0404.cookies"
login test0404 E4vr "$JAR0"
api_get "$JAR0" '/api/v1/student/special-areas?viewId=english-year5-11plus' "$TMP/no-special.json"
jq -e '.areas == []' "$TMP/no-special.json" >/dev/null
DENIED_CODE="$(curl --silent --show-error --output "$TMP/denied.json" --write-out '%{http_code}' --cookie "$JAR0" --cookie-jar "$JAR0" --header "Origin: $ORIGIN" "$WORKER_BASE/api/v1/student/special-areas/VR_HOWTO?viewId=english-year5-11plus")"
test "$DENIED_CODE" = "403"
jq -e '.error == "SPECIAL_ACCESS_REQUIRED"' "$TMP/denied.json" >/dev/null

echo 'Phase 10 deployed API acceptance: PASS'
