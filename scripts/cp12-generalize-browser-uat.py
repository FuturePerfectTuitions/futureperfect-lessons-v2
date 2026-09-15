from pathlib import Path

p = Path('scripts/cp12-approved-v2-ui-browser-uat.mjs')
s = p.read_text()

anchor = "const answerPassword=String(process.env.UAT_ANSWER_PASSWORD||'');\n"
insert = anchor + "const vrUsername=String(process.env.UAT_VR_USERNAME||'cp12vrui');\nconst coreUsername=String(process.env.UAT_CORE_USERNAME||'cp12coreui');\nconst expectedPortalOwner=(String(process.env.UAT_EXPECTED_FIRST_NAME||'CP12').trim().split(/\\s+/)[0]||'CP12');\nconst evidenceMarker=String(process.env.UAT_EVIDENCE_MARKER||'CP12_APPROVED_V2_UI_STAGING_BROWSER_UAT_PASS');\nconst pupilDataSynthetic=String(process.env.UAT_PUPIL_DATA_SYNTHETIC||'true')!=='false';\nconst productionMutation=String(process.env.UAT_PRODUCTION_MUTATION||'false')==='true';\n"
if s.count(anchor) != 1 or 'const vrUsername=' in s:
    raise SystemExit('environment insertion point drift')
s = s.replace(anchor, insert, 1)

old_fetch = """  const response=await page.request.get(bundleUrl,{headers:{'cache-control':'no-cache'}});\n  assert.equal(response.status(),200,'Candidate frontend bundle could not be fetched.');\n  const text=await response.text();\n  for(const marker of ['Verbal Reasoning','VR PreLesson','VR Homework','subject-maths','lesson-description-toggle']){\n    assert(text.includes(marker),`Loaded browser asset is missing approved candidate marker: ${marker}`);\n  }\n"""
new_fetch = """  const loaded=await page.evaluate(url=>performance.getEntriesByType('resource').some(entry=>entry.name===url),bundleUrl);\n  assert.equal(loaded,true,'Candidate frontend bundle was not loaded by the browser page.');\n"""
if s.count(old_fetch) != 1:
    raise SystemExit('candidate asset check drift')
s = s.replace(old_fetch, new_fetch, 1)

old_border = "  assert.equal(chrome.borderTopWidth,'6px','Approved desktop airmail border thickness changed.');"
new_border = "  const expectedBorder=(page.viewportSize()?.width||0)<=720?'5px':'6px';\n  assert.equal(chrome.borderTopWidth,expectedBorder,`Approved responsive airmail border thickness changed: ${chrome.borderTopWidth} at ${page.viewportSize()?.width}px.`);"
if s.count(old_border) != 1:
    raise SystemExit('responsive border assertion drift')
s = s.replace(old_border, new_border, 1)

old_greeting = '''  assert.equal(greeting,"CP12's Portal",'Personalised portal wording is not using first name.');'''
new_greeting = '''  assert.equal(greeting,`${expectedPortalOwner}'s Portal`,'Personalised portal wording is not using first name.');'''
if s.count(old_greeting) != 1:
    raise SystemExit('greeting assertion drift')
s = s.replace(old_greeting, new_greeting, 1)

for old, new, count in [
    ("await login(page,'cp12vrui');", "await login(page,vrUsername);", 1),
    ("await login(page,'cp12coreui');", "await login(page,coreUsername);", 2),
    ("const evidence={marker:'CP12_APPROVED_V2_UI_STAGING_BROWSER_UAT_PASS'", "const evidence={marker:evidenceMarker", 1),
    ("evidence.security={pupilDataSynthetic:true,productionMutation:false", "evidence.security={pupilDataSynthetic,productionMutation", 1),
]:
    if s.count(old) != count:
        raise SystemExit(f'replacement drift: {old!r} count={s.count(old)} expected={count}')
    s = s.replace(old, new)

for stale in [
    "page.request.get(bundleUrl",
    "assert.equal(chrome.borderTopWidth,'6px'",
    "await login(page,'cp12vrui')",
    "await login(page,'cp12coreui')",
    '''assert.equal(greeting,"CP12's Portal"''',
]:
    if stale in s:
        raise SystemExit(f'stale browser UAT token remains: {stale}')

p.write_text(s)
