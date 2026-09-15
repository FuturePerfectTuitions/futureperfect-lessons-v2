from pathlib import Path

p = Path('.github/workflows/cp12-approved-v2-ui-production-promote.yml')
s = p.read_text()

old = '''          jq '[.result.bindings[]|if .type=="assets" then {name,type} else . end]|sort_by(.name)' "/tmp/${BROWSER_WORKER}-settings-before.json" >/tmp/browser-bindings-before.json
          echo CP12_RESOURCE_UI_IMMEDIATE_PREWRITE_GATE_PASS
'''
new = '''          jq '[.result.bindings[]|if .type=="assets" then {name,type} else . end]|sort_by(.name)' "/tmp/${BROWSER_WORKER}-settings-before.json" >/tmp/browser-bindings-before.json
          ADMIN_PREWRITE_JSON="$(curl --fail --silent --show-error "${API}/storage/kv/namespaces/${EXPECTED_STUDENTS_KV}/values/user%3Aadmin" "${AUTH[@]}")"
          ADMIN_LOGIN_PREWRITE="$(printf '%s' "$ADMIN_PREWRITE_JSON" | jq -r '.p // empty')"
          ADMIN_ANSWER_PREWRITE="$(printf '%s' "$ADMIN_PREWRITE_JSON" | jq -r '.answerPassword // .answer_password // .answerPackPassword // .answer_pack_password // .ap // empty')"
          ADMIN_FIRST_PREWRITE="$(printf '%s' "$ADMIN_PREWRITE_JSON" | jq -r '.firstName // .name // empty')"
          echo "::add-mask::$ADMIN_LOGIN_PREWRITE"; echo "::add-mask::$ADMIN_ANSWER_PREWRITE"; echo "::add-mask::$ADMIN_FIRST_PREWRITE"
          valid4(){ local value="$1"; [ "${#value}" -eq 4 ] && [[ "$value" =~ [A-Z] ]] && [[ "$value" =~ [a-z] ]] && [[ "$value" =~ [0-9] ]]; }
          valid4 "$ADMIN_LOGIN_PREWRITE"; valid4 "$ADMIN_ANSWER_PREWRITE"; test -n "$ADMIN_FIRST_PREWRITE"
          unset ADMIN_PREWRITE_JSON ADMIN_LOGIN_PREWRITE ADMIN_ANSWER_PREWRITE ADMIN_FIRST_PREWRITE
          echo CP12_APPROVED_V2_UI_ADMIN_PREWRITE_CREDENTIAL_GATE_PASS
          echo CP12_RESOURCE_UI_IMMEDIATE_PREWRITE_GATE_PASS
'''
if s.count(old) != 1:
    raise SystemExit('prewrite insertion point drift')
s = s.replace(old, new, 1)

old = '''      - name: Automatic full rollback on any post-metadata failure
        if: failure() && env.METADATA_PUBLISHED == 'true'
        shell: bash
        env:
          CP12_METADATA_ACTION: rollback
          CP12_ROLLBACK_REASON: automatic after production promotion failure
        run: |
          set +e
          echo 'CP12 resource UI failure detected; restoring Browser, Student and prepared pointers.'
          if [ -n "${BROWSER_BEFORE:-}" ]; then npx wrangler@"$WRANGLER_VERSION" versions deploy "${BROWSER_BEFORE}@100%" --name "$BROWSER_WORKER" -y --message 'CP12 resource UI full automatic Browser rollback'; fi
          if [ -n "${STUDENT_BEFORE:-}" ]; then npx wrangler@"$WRANGLER_VERSION" versions deploy "${STUDENT_BEFORE}@100%" --name "$STUDENT_WORKER" -y --message 'CP12 resource UI full automatic Student rollback'; fi
          node scripts/cp12-resource-ui-production-metadata.mjs
          ROLLBACK_RC=$?
'''
new = '''      - name: Automatic full rollback on any promotion failure
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
'''
if s.count(old) != 1:
    raise SystemExit('rollback block drift')
s = s.replace(old, new, 1)

p.write_text(s)
