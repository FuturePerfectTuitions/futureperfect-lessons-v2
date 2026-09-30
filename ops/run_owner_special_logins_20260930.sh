#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"
: "${CLOUDFLARE_ACCOUNT_ID:?}"
work=/tmp/fpt-owner-special-logins
rm -rf "$work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in .github/secure-transfer/l3t1m02/private.pem.enc \
  -out "$work/private.pem" \
  -pass env:CLOUDFLARE_API_TOKEN
base64 -d .github/secure-transfer/owner-special-logins-20260930/credential.rsa.b64 > "$work/credential.rsa"
openssl pkeyutl -decrypt -inkey "$work/private.pem" -in "$work/credential.rsa" -out "$work/credential.txt"
secret="$(cat "$work/credential.txt")"
echo "::add-mask::$secret"
test "${#secret}" = 4
unset secret
node ops/provision_owner_special_logins_20260930.mjs "$work/credential.txt"
