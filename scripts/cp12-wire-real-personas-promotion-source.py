from pathlib import Path

p = Path('.github/workflows/cp12-approved-v2-ui-production-promote.yml')
s = p.read_text()

upload_anchor = '      - name: Upload Student and Browser candidates as undeployed versions\n'
uat_start = '      - name: Promote Browser candidate and run cache-safe public hierarchy UAT\n'
final_anchor = '      - name: Final topology bindings versions rollback-retention and legacy guard verification\n'
evidence_anchor = '      - name: Upload production promotion evidence\n'
for label, anchor in [('upload', upload_anchor), ('uat', uat_start), ('final', final_anchor), ('evidence', evidence_anchor)]:
    if s.count(anchor) != 1:
        raise SystemExit(f'Expected exactly one {label} anchor.')
if 'UAT_USERNAME="admin"' not in s:
    raise SystemExit('Expected stale admin UAT wiring was not found.')
if 'CP12_REAL_PRODUCTION_UAT_PERSONAS_PREWRITE_PASS' in s:
    raise SystemExit('Real-persona promotion wiring already appears present.')

persona_step = '''      - name: Select privacy-safe real production UAT principals before any production write
        shell: bash
        env:
          STUDENTS_KV_ID: ${{ env.EXPECTED_STUDENTS_KV }}
          CP12_PERSONA_SUMMARY: /tmp/cp12-production-real-persona-prereq.json
          CP12_PERSONA_SECRETS: /tmp/cp12-production-real-persona-secrets.json
        run: |
          set -Eeuo pipefail
          node --check scripts/cp12-production-real-persona-prereq.mjs
          node scripts/cp12-production-real-persona-prereq.mjs
          jq -e '.marker=="CP12_PRODUCTION_REAL_PERSONA_PREREQ_READONLY_PASS" and .status=="PASS" and .productionMutation==false and .ordinary.y5e2Open==true and .ordinary.year5ElevenPlusAbsent==true and .vr.y5e2Open==true and .ordinary.credentialDisclosed==false and .vr.credentialDisclosed==false and .secretMaterialLogged==false' "$CP12_PERSONA_SUMMARY" >/dev/null
          test -s "$CP12_PERSONA_SECRETS"
          chmod 600 "$CP12_PERSONA_SECRETS"
          echo CP12_REAL_PRODUCTION_UAT_PERSONAS_PREWRITE_PASS

'''
s = s.replace(upload_anchor, persona_step + upload_anchor, 1)

start = s.index(uat_start)
end = s.index(final_anchor, start)
new_uat = '''      - name: Promote Browser candidate and run cache-safe real-student public hierarchy UAT
        shell: bash
        env:
          CP12_PERSONA_SECRETS: /tmp/cp12-production-real-persona-secrets.json
        run: |
          set -Eeuo pipefail
          rollback_browser(){ npx wrangler@"$WRANGLER_VERSION" versions deploy "${BROWSER_BEFORE}@100%" --name "$BROWSER_WORKER" -y --message 'CP12 resource UI automatic Browser rollback' || true; }
          trap rollback_browser ERR
          npx wrangler@"$WRANGLER_VERSION" versions deploy "${BROWSER_CANDIDATE}@100%" --name "$BROWSER_WORKER" -y --message 'CP12 collapsible resource hierarchy'
          sleep 2
          npx playwright install --with-deps chromium
          test -s "$CP12_PERSONA_SECRETS"
          EXPECTED_JS="$(basename "$(find candidate-frontend/dist/assets -maxdepth 1 -type f -name 'portal-*.js' ! -name '*protected-viewer*' | head -n1)")"
          curl --fail --silent --show-error -H 'cache-control: no-cache' "$PROD_BASE/?cp12-approved-v2-ui=${GITHUB_RUN_ID}" -o /tmp/cp12-approved-v2-ui-public-index.html
          grep -F "/assets/${EXPECTED_JS}" /tmp/cp12-approved-v2-ui-public-index.html >/dev/null
          export UAT_EXPECTED_JS="$EXPECTED_JS" CP12_BROWSER_BASE_URL="$PROD_BASE"
          node --check scripts/cp12-approved-v2-ui-production-uat.mjs
          node --check scripts/cp12-run-real-persona-production-uat.mjs
          node scripts/cp12-run-real-persona-production-uat.mjs
          cp /tmp/cp12-approved-v2-ui-production-uat.json /tmp/cp12-resource-ui-browser-uat.json
          rm -rf /tmp/cp12-resource-ui-browser-evidence
          cp -a /tmp/cp12-approved-v2-ui-production-evidence /tmp/cp12-resource-ui-browser-evidence
          jq -e '.marker=="CP12_APPROVED_V2_UI_PRODUCTION_BROWSER_UAT_PASS" and .visual.personalisedPortal!=null and .visual.back.position=="fixed" and .visual.answerPassword.eyeIcon==true and .vr.realStudentPrincipal==true and .vr.outerSection==true and .vr.preLessonSubgroup==true and .vr.homeworkSubgroup==true and .vr.protectedAnswers>=2 and .ordinary.realStudentPrincipal==true and .ordinary.vrRowsHidden==true and .ordinary.vrSectionAbsent==true and .mobile.realStudentPrincipal==true and .security.realStudentPrincipals==true and .security.ordinaryNoVrIsolation==true and .security.answerControlsRemainPasswordGated==true' /tmp/cp12-approved-v2-ui-production-uat.json >/dev/null
          trap - ERR
          echo CP12_RESOURCE_UI_REAL_STUDENT_PUBLIC_BROWSER_UAT_PASS

'''
s = s[:start] + new_uat + s[end:]

cleanup = '''      - name: Always remove ephemeral real-student UAT credentials
        if: always()
        shell: bash
        run: rm -f /tmp/cp12-production-real-persona-secrets.json

'''
s = s.replace(evidence_anchor, cleanup + evidence_anchor, 1)

path_anchor = '            /tmp/cp12-resource-ui-candidate-upload.json\n'
if s.count(path_anchor) != 1:
    raise SystemExit('Expected evidence path anchor once.')
s = s.replace(path_anchor, '            /tmp/cp12-production-real-persona-prereq.json\n' + path_anchor, 1)

check_anchor = '          node --check scripts/cp12-resource-ui-production-metadata.mjs\n'
if s.count(check_anchor) != 1:
    raise SystemExit('Expected exact source check anchor once.')
extra = '''          node --check scripts/cp12-production-real-persona-prereq.mjs
          node --check scripts/cp12-approved-v2-ui-production-uat.mjs
          node --check scripts/cp12-run-real-persona-production-uat.mjs
          grep -F 'UAT_VR_USERNAME' scripts/cp12-approved-v2-ui-production-uat.mjs >/dev/null
          grep -F 'UAT_ORDINARY_USERNAME' scripts/cp12-approved-v2-ui-production-uat.mjs >/dev/null
          ! grep -F 'export UAT_EXPECTED_JS="$EXPECTED_JS" UAT_USERNAME=' .github/workflows/cp12-approved-v2-ui-production-promote.yml
'''
s = s.replace(check_anchor, check_anchor + extra, 1)

required = [
    'CP12_REAL_PRODUCTION_UAT_PERSONAS_PREWRITE_PASS',
    'cp12-run-real-persona-production-uat.mjs',
    'Always remove ephemeral real-student UAT credentials',
    'ordinaryNoVrIsolation',
]
for token in required:
    if token not in s:
        raise SystemExit(f'Missing post-patch token: {token}')
if 'export UAT_EXPECTED_JS="$EXPECTED_JS" UAT_USERNAME=' in s:
    raise SystemExit('Stale admin-as-ordinary UAT wiring remains.')
if '/tmp/cp12-production-real-persona-secrets.json\n' in s[s.index('path: |', s.index(evidence_anchor)):]:
    raise SystemExit('Secret persona file must never be uploaded as evidence.')

p.write_text(s)
print('CP12_REAL_PERSONA_PROMOTION_SOURCE_PATCH_PASS')
