from pathlib import Path

p = Path('.github/workflows/cp12-approved-v2-ui-production-promote.yml')
s = p.read_text()

replacements = {
    "PREFLIGHT_RUN_ID: '34931964265'": "PREFLIGHT_RUN_ID: '34934456421'",
    "PREFLIGHT_HEAD_SHA: 82b3db54047529e26e6e165f55bad7cf3dd4298a": "PREFLIGHT_HEAD_SHA: 5eb1e5f87d895adfe3855e78e8143904cd496873",
    '.path==".github/workflows/cp12-approved-v2-ui-production-preflight-v2.yml"': '.path==".github/workflows/cp12-approved-v2-ui-production-preflight-v3.yml"',
    'name: cp12-resource-ui-production-promotion-v2': 'name: cp12-approved-v2-ui-production-promotion-v3',
}
for old, new in replacements.items():
    if s.count(old) != 1:
        raise SystemExit(f'promotion v3 token drift: {old!r} count={s.count(old)}')
    s = s.replace(old, new, 1)

anchor = "  PREFLIGHT_HEAD_SHA: 5eb1e5f87d895adfe3855e78e8143904cd496873\n"
insert = anchor + "  METADATA_HELPER_BLOB: 4cda45292706942a0e9f6b3c701a71c2a55c7d91\n"
if s.count(anchor) != 1 or 'METADATA_HELPER_BLOB:' in s:
    raise SystemExit('metadata helper env insertion drift')
s = s.replace(anchor, insert, 1)

anchor = '          git merge-base --is-ancestor "$OFFICIAL_CP12_SHA" HEAD\n'
insert = anchor + '          test "$(git hash-object scripts/cp12-resource-ui-production-metadata.mjs)" = "$METADATA_HELPER_BLOB"\n'
if s.count(anchor) != 1:
    raise SystemExit('metadata helper hash gate insertion drift')
s = s.replace(anchor, insert, 1)

old = '''      - name: Automatic full rollback on any promotion failure
        if: failure()
        shell: bash
        env:
          CP12_METADATA_ACTION: rollback
          CP12_ROLLBACK_REASON: automatic after production promotion failure
        run: |
          set +e
          echo 'CP12 approved V2 UI failure detected; restoring any changed Browser, Student and prepared pointers.'
          if [ -n "${BROWSER_BEFORE:-}" ]; then npx wrangler@"$WRANGLER_VERSION" versions deploy "${BROWSER_BEFORE}@100%" --name "$BROWSER_WORKER" -y --message 'CP12 approved V2 UI full automatic Browser rollback'; fi
          if [ -n "${STUDENT_BEFORE:-}" ]; then npx wrangler@"$WRANGLER_VERSION" versions deploy "${STUDENT_BEFORE}@100%" --name "$STUDENT_WORKER" -y --message 'CP12 approved V2 UI full automatic Student rollback'; fi
          ROLLBACK_RC=0
          if [ -s "$CP12_METADATA_BACKUP" ]; then
            node scripts/cp12-resource-ui-production-metadata.mjs
            ROLLBACK_RC=$?
          else
            echo 'No prepared-pointer backup exists; metadata publication had not started.'
          fi
          AUTH=(--header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
          API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
          curl --fail --silent --show-error "${API}/workers/scripts/${STUDENT_WORKER}/deployments" "${AUTH[@]}" -o /tmp/student-rollback-deployments.json
          curl --fail --silent --show-error "${API}/workers/scripts/${BROWSER_WORKER}/deployments" "${AUTH[@]}" -o /tmp/browser-rollback-deployments.json
          test "$(jq -r '.result.deployments[0].versions[]|select((.percentage//0)==100)|.version_id' /tmp/student-rollback-deployments.json | head -n1)" = "$STUDENT_BEFORE"
          test "$(jq -r '.result.deployments[0].versions[]|select((.percentage//0)==100)|.version_id' /tmp/browser-rollback-deployments.json | head -n1)" = "$BROWSER_BEFORE"
          test "$ROLLBACK_RC" = '0'
          echo CP12_RESOURCE_UI_AUTOMATIC_FULL_ROLLBACK_PASS
'''
new = '''      - name: Automatic full rollback on any promotion failure
        if: failure()
        shell: bash
        env:
          CP12_METADATA_ACTION: rollback
          CP12_ROLLBACK_REASON: automatic after production promotion failure
          CP12_KV_VERIFY_TIMEOUT_MS: '120000'
          CP12_KV_VERIFY_POLL_MS: '1500'
          CP12_KV_VERIFY_CONCURRENCY: '12'
        run: |
          set +e
          OVERALL_RC=0
          echo 'CP12 approved V2 UI failure detected; restoring any changed Browser, Student and prepared pointers.'
          if [ -n "${BROWSER_BEFORE:-}" ]; then
            npx wrangler@"$WRANGLER_VERSION" versions deploy "${BROWSER_BEFORE}@100%" --name "$BROWSER_WORKER" -y --message 'CP12 approved V2 UI full automatic Browser rollback' || OVERALL_RC=1
          fi
          if [ -n "${STUDENT_BEFORE:-}" ]; then
            npx wrangler@"$WRANGLER_VERSION" versions deploy "${STUDENT_BEFORE}@100%" --name "$STUDENT_WORKER" -y --message 'CP12 approved V2 UI full automatic Student rollback' || OVERALL_RC=1
          fi
          if [ -s "$CP12_METADATA_BACKUP" ]; then
            node scripts/cp12-resource-ui-production-metadata.mjs || OVERALL_RC=1
          else
            echo 'No prepared-pointer backup exists; metadata publication had not started.'
          fi
          AUTH=(--header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
          API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
          if [ -n "${STUDENT_BEFORE:-}" ]; then
            curl --fail --silent --show-error "${API}/workers/scripts/${STUDENT_WORKER}/deployments" "${AUTH[@]}" -o /tmp/student-rollback-deployments.json || OVERALL_RC=1
            if [ -s /tmp/student-rollback-deployments.json ]; then
              test "$(jq -r '.result.deployments[0].versions[]|select((.percentage//0)==100)|.version_id' /tmp/student-rollback-deployments.json | head -n1)" = "$STUDENT_BEFORE" || OVERALL_RC=1
            else
              OVERALL_RC=1
            fi
          fi
          if [ -n "${BROWSER_BEFORE:-}" ]; then
            curl --fail --silent --show-error "${API}/workers/scripts/${BROWSER_WORKER}/deployments" "${AUTH[@]}" -o /tmp/browser-rollback-deployments.json || OVERALL_RC=1
            if [ -s /tmp/browser-rollback-deployments.json ]; then
              test "$(jq -r '.result.deployments[0].versions[]|select((.percentage//0)==100)|.version_id' /tmp/browser-rollback-deployments.json | head -n1)" = "$BROWSER_BEFORE" || OVERALL_RC=1
            else
              OVERALL_RC=1
            fi
          fi
          if [ "$OVERALL_RC" -ne 0 ]; then
            echo CP12_RESOURCE_UI_AUTOMATIC_FULL_ROLLBACK_FAIL >&2
            exit 1
          fi
          echo CP12_RESOURCE_UI_AUTOMATIC_FULL_ROLLBACK_PASS
'''
if s.count(old) != 1:
    raise SystemExit(f'rollback block drift count={s.count(old)}')
s = s.replace(old, new, 1)

# Make the normal apply path explicit about the same bounded exact-verification policy.
anchor = '''      - name: Publish presentationGroup metadata to published prepared lesson scopes only
        shell: bash
        env:
          CP12_METADATA_ACTION: apply
'''
insert = '''      - name: Publish presentationGroup metadata to published prepared lesson scopes only
        shell: bash
        env:
          CP12_METADATA_ACTION: apply
          CP12_KV_VERIFY_TIMEOUT_MS: '120000'
          CP12_KV_VERIFY_POLL_MS: '1500'
          CP12_KV_VERIFY_CONCURRENCY: '12'
'''
if s.count(anchor) != 1:
    raise SystemExit('apply convergence env insertion drift')
s = s.replace(anchor, insert, 1)

# Fail closed if any stale v2 authority remains.
for stale in [
    "PREFLIGHT_RUN_ID: '34931964265'",
    '82b3db54047529e26e6e165f55bad7cf3dd4298a',
    '.github/workflows/cp12-approved-v2-ui-production-preflight-v2.yml',
    'name: cp12-resource-ui-production-promotion-v2',
]:
    if stale in s:
        raise SystemExit(f'stale promotion authority remains: {stale}')

p.write_text(s)
