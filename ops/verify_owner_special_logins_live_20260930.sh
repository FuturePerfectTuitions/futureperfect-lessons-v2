#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
work=/tmp/fpt-owner-special-verify
rm -rf "$work"; mkdir -p "$work"
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in .github/secure-transfer/l3t1m02/private.pem.enc \
  -out "$work/private.pem" -pass env:CLOUDFLARE_API_TOKEN
base64 -d .github/secure-transfer/owner-special-logins-20260930/credential.rsa.b64 > "$work/credential.rsa"
openssl pkeyutl -decrypt -inkey "$work/private.pem" -in "$work/credential.rsa" -out "$work/credential.txt"
secret="$(cat "$work/credential.txt")"; echo "::add-mask::$secret"; unset secret
BASE='https://fpt-portal-v2-worker.futureperfectlessons.workers.dev'
login(){
  local id="$1"
  jq -nc --arg u "$id" --rawfile p "$work/credential.txt" '{username:$u,password:$p}' > "$work/login-body.json"
  curl -fsS -c "$work/cookies-$id" -H 'Content-Type: application/json' --data @"$work/login-body.json" "$BASE/api/v1/student/auth/login" > "$work/login-$id.json"
  jq -e '.ok==true' "$work/login-$id.json" >/dev/null
  curl -fsS -b "$work/cookies-$id" "$BASE/api/v1/student/session" > "$work/session-$id.json"
  jq -e --arg id "$id" '.ok==true and ((.portalUserId // .student.portalUserId)|ascii_downcase)==$id' "$work/session-$id.json" >/dev/null
  curl -fsS -b "$work/cookies-$id" "$BASE/api/v1/student/home" > "$work/home-$id.json"
  jq -e '.ok==true' "$work/home-$id.json" >/dev/null
}
login admin0206
login admin0411

maths_labels(){ jq -r '.subjects[]|select((.subject|ascii_downcase)=="maths")|.views[]|select(.current==true or .group=="current")|.label' "$1" | sort -u; }
english_labels(){ jq -r '.subjects[]|select((.subject|ascii_downcase)=="english")|.views[]|select(.current==true or .group=="current")|.label' "$1" | sort -u; }
maths_labels "$work/home-admin0206.json" > "$work/maths-normal.txt"
english_labels "$work/home-admin0206.json" > "$work/english-normal.txt"
maths_labels "$work/home-admin0411.json" > "$work/maths-11.txt"
english_labels "$work/home-admin0411.json" > "$work/english-11.txt"
for label in 'Year 3' 'Year 4' 'Year 5' 'Year 6' 'SATS'; do grep -Fxq "$label" "$work/maths-normal.txt"; done
for bad in 'L1' 'L2' 'L3'; do ! grep -Fxq "$bad" "$work/maths-normal.txt"; done
for label in 'Year 3' 'Year 4' 'Year 5' 'Year 6'; do grep -Fxq "$label" "$work/english-normal.txt"; done
for label in 'L1' 'L2' 'L3' 'SATS'; do grep -Fxq "$label" "$work/maths-11.txt"; done
for bad in 'Year 4' 'Year 5' 'Year 6'; do ! grep -Fxq "$bad" "$work/maths-11.txt"; done
for label in 'Year 4 11+' 'Year 5 11+'; do grep -Fxq "$label" "$work/english-11.txt"; done

curl -fsS -b "$work/cookies-admin0206" "$BASE/api/v1/student/quiz/eligibility" > "$work/quiz-normal.json"
jq -e '.eligible==false' "$work/quiz-normal.json" >/dev/null
curl -fsS -b "$work/cookies-admin0411" "$BASE/api/v1/student/quiz/eligibility" > "$work/quiz-11.json"
jq -e '.ok==true and .eligible==true and .currentLevel=="L3"' "$work/quiz-11.json" >/dev/null

echo 'OWNER_SPECIAL_LOGINS_LIVE_AUTH_AND_HOME_PASS'
echo 'admin0206 maths: Year 3 | Year 4 | Year 5 | Year 6 | SATS; quiz=false'
echo 'admin0411 maths: L1 | L2 | L3 | SATS; quiz=true'
