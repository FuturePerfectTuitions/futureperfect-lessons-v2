from pathlib import Path

p=Path('.github/workflows/cp12-approved-v2-ui-production-promote.yml')
s=p.read_text()
start="          cp scripts/cp12-approved-v2-ui-browser-uat.mjs scripts/.cp12-production-approved-v2-ui-uat.mjs\n"
end="          jq -e '.marker==\"CP12_APPROVED_V2_UI_PRODUCTION_BROWSER_UAT_PASS\" and .visual.personalisedPortal!=null and .visual.back.position==\"fixed\" and .visual.answerPassword.eyeIcon==true and .vr.outerSection==true and .vr.preLessonSubgroup==true and .vr.homeworkSubgroup==true and .vr.protectedAnswers>=2 and .ordinary.vrSectionAbsent==true and .security.answerControlsRemainPasswordGated==true' /tmp/cp12-approved-v2-ui-browser-uat.json >/dev/null\n"
if s.count(start)!=1 or s.count(end)!=1:
    raise SystemExit('Production UAT workflow patch points drifted.')
a=s.index(start)
b=s.index(end,a)
replacement=(
    '          export UAT_EXPECTED_JS="$EXPECTED_JS" UAT_USERNAME="admin"\n'
    '          node --check scripts/cp12-approved-v2-ui-production-uat.mjs\n'
    '          node scripts/cp12-approved-v2-ui-production-uat.mjs\n'
    '          cp /tmp/cp12-approved-v2-ui-production-uat.json /tmp/cp12-resource-ui-browser-uat.json\n'
    '          rm -rf /tmp/cp12-resource-ui-browser-evidence\n'
    '          cp -a /tmp/cp12-approved-v2-ui-production-evidence /tmp/cp12-resource-ui-browser-evidence\n'
)
s=s[:a]+replacement+s[b:]
for forbidden in ['scripts/.cp12-production-approved-v2-ui-uat.mjs','PYUAT','old_fetch=','s=s.replace(']:
    if forbidden in s: raise SystemExit(f'Fragile production UAT transform remains: {forbidden}')
if s.count('node scripts/cp12-approved-v2-ui-production-uat.mjs')!=1:
    raise SystemExit('Direct production UAT invocation count mismatch.')
p.write_text(s)
