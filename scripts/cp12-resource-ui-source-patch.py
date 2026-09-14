from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new))


collector = 'rebuild/shared/read-models/phase11-extension-resources.mjs'
replace_once(
    collector,
    "function pushFile(rows, value, { type, fallbackName, scope, protectedResource = false }) {",
    "function pushFile(rows, value, { type, fallbackName, scope, group = '', protectedResource = false }) {",
)
replace_once(
    collector,
    "    ...(protectedResource ? { protected: true } : {}),\n    ...(scope === 'core' ? {} : { presentationScopes: [scope] })",
    "    ...(protectedResource ? { protected: true } : {}),\n    ...(group ? { presentationGroup: group } : {}),\n    ...(scope === 'core' ? {} : { presentationScopes: [scope] })",
)
replace_once(
    collector,
    "function pushPairs(rows, values, { primaryKeys, primaryType, primaryFallback, answerFallback, scope }) {",
    "function pushPairs(rows, values, { primaryKeys, primaryType, primaryFallback, answerFallback, scope, group }) {",
)
replace_once(
    collector,
    "      fallbackName: primaryFallback,\n      scope\n    });\n    pushFile(rows, normalized.answer, {\n      type: 'answer-pack',\n      fallbackName: answerFallback,\n      scope,\n      protectedResource: true",
    "      fallbackName: primaryFallback,\n      scope,\n      group\n    });\n    pushFile(rows, normalized.answer, {\n      type: 'answer-pack',\n      fallbackName: answerFallback,\n      scope,\n      group,\n      protectedResource: true",
)

for old, new in {
    "    scope: 'core'\n  });\n  pushPairs(rows, core.cumulativeHomeworks": "    scope: 'core',\n    group: 'core-prelesson'\n  });\n  pushPairs(rows, core.cumulativeHomeworks",
    "    scope: 'core'\n  });\n  for (const answer of Array.isArray(core.supplementaryAnswers)": "    scope: 'core',\n    group: 'core-cumulative'\n  });\n  for (const answer of Array.isArray(core.supplementaryAnswers)",
    "      type: 'answer-pack', fallbackName: 'Additional Answer Pack', scope: 'core', protectedResource: true": "      type: 'answer-pack', fallbackName: 'Additional Answer Pack', scope: 'core', group: 'core-answers', protectedResource: true",
    "    scope: 'elevenPlus'\n  });\n  pushPairs(rows, elevenPlus.homeworks": "    scope: 'elevenPlus',\n    group: 'elevenplus-prelesson'\n  });\n  pushPairs(rows, elevenPlus.homeworks",
    "    scope: 'elevenPlus'\n  });\n  pushPairs(rows, elevenPlus.cumulativeHomeworks": "    scope: 'elevenPlus',\n    group: 'elevenplus-homework'\n  });\n  pushPairs(rows, elevenPlus.cumulativeHomeworks",
    "    scope: 'elevenPlus'\n  });\n  for (const answer of Array.isArray(elevenPlus.supplementaryAnswers)": "    scope: 'elevenPlus',\n    group: 'elevenplus-cumulative'\n  });\n  for (const answer of Array.isArray(elevenPlus.supplementaryAnswers)",
    "      type: 'answer-pack', fallbackName: 'Additional 11+ Answer Pack', scope: 'elevenPlus', protectedResource: true": "      type: 'answer-pack', fallbackName: 'Additional 11+ Answer Pack', scope: 'elevenPlus', group: 'elevenplus-answers', protectedResource: true",
    "    scope: 'vr'\n  });\n  pushPairs(rows, canonicalVr.homeworks": "    scope: 'vr',\n    group: 'vr-prelesson'\n  });\n  pushPairs(rows, canonicalVr.homeworks",
    "    scope: 'vr'\n  });\n  for (const answer of Array.isArray(vr.supplementaryAnswers)": "    scope: 'vr',\n    group: 'vr-homework'\n  });\n  for (const answer of Array.isArray(vr.supplementaryAnswers)",
    "      type: 'answer-pack', fallbackName: 'Additional VR Answer Pack', scope: 'vr', protectedResource: true": "      type: 'answer-pack', fallbackName: 'Additional VR Answer Pack', scope: 'vr', group: 'vr-answers', protectedResource: true",
}.items():
    replace_once(collector, old, new)

compiler = 'rebuild/adminops/src/lib/compiler.mjs'
replace_once(
    compiler,
    "    if (resource) resources.push({ type: 'prelesson', ...resource });",
    "    if (resource) resources.push({ type: 'prelesson', presentationGroup: 'core-prelesson', ...resource });",
)
replace_once(
    compiler,
    "    if (homework) resources.push({ type: 'homework', ...homework });",
    "    if (homework) resources.push({ type: 'homework', presentationGroup: 'core-homework', ...homework });",
)
replace_once(
    compiler,
    "    if (answer) resources.push({ type: 'answer-pack', protected: true, ...answer });",
    "    if (answer) resources.push({ type: 'answer-pack', protected: true, presentationGroup: 'core-homework', ...answer });",
)
replace_once(
    compiler,
    "    if (resource) resources.push({ type: 'other', ...resource });",
    "    if (resource) resources.push({ type: 'other', presentationGroup: 'core-other', ...resource });",
)
replace_once(
    compiler,
    "    const protectedResource = existing.protected === true || source.protected === true;",
    "    const protectedResource = existing.protected === true || source.protected === true;\n    const presentationGroup = clean(existing.presentationGroup || source.presentationGroup);",
)
replace_once(
    compiler,
    "      ...(protectedResource ? { protected: true } : {}),\n      ...(presentationScopes ? { presentationScopes } : {})",
    "      ...(protectedResource ? { protected: true } : {}),\n      ...(presentationGroup ? { presentationGroup } : {}),\n      ...(presentationScopes ? { presentationScopes } : {})",
)
replace_once(
    compiler,
    "      ...(resource.protected ? { protected: true } : {}),\n      ...(scopes.length === 1 && scopes[0] === 'core' ? {} : { presentationScopes: scopes })",
    "      ...(resource.protected ? { protected: true } : {}),\n      ...(clean(resource.presentationGroup) ? { presentationGroup: clean(resource.presentationGroup) } : {}),\n      ...(scopes.length === 1 && scopes[0] === 'core' ? {} : { presentationScopes: scopes })",
)

runtime = 'rebuild/student/src/lib/runtime.mjs'
replace_once(
    runtime,
    "import { resourceVisibleForView } from '../../../shared/read-models/resource-visibility.mjs';",
    "import { resourcePresentationScopes, resourceVisibleForView } from '../../../shared/read-models/resource-visibility.mjs';",
)
replace_once(
    runtime,
    "      displayName: clean(resource.displayName),\n      protected: resource.protected === true",
    "      displayName: clean(resource.displayName),\n      protected: resource.protected === true,\n      presentationScopes: resourcePresentationScopes(resource),\n      ...(clean(resource.presentationGroup) ? { presentationGroup: clean(resource.presentationGroup) } : {})",
)

Path('tests/rebuild-cp12-resource-presentation-groups.mjs').write_text(r'''import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';

const detail = await compileLessonDetail({
  lessonId:'Y5E2', title:'Fixture',
  preLessonSheets:[{r2Key:'core-pre.pdf',displayName:'Core Pre'}],
  homeworks:[{homework:{r2Key:'core-home.pdf',displayName:'Core Homework'},answerPack:{r2Key:'core-home-a.pdf',displayName:'Core Answer'}}],
  phase11Resources:{
    core:{cumulativeHomeworks:[{homework:{r2Key:'core-cum.pdf'},answerPack:{r2Key:'core-cum-a.pdf'}}]},
    elevenPlus:{
      preLessonPairs:[{sheet:{r2Key:'11-pre.pdf'},answerPack:{r2Key:'11-pre-a.pdf'}}],
      homeworks:[{homework:{r2Key:'11-home.pdf'},answerPack:{r2Key:'11-home-a.pdf'}}]
    },
    vr:{supplementaryAnswers:[{r2Key:'vr-extra-a.pdf'}]}
  },
  vr:{
    preLesson:[{sheet:{r2Key:'vr-pre.pdf'},answerKey:{r2Key:'vr-pre-a.pdf'}}],
    homeworks:[{homework:{r2Key:'vr-home.pdf'},answerPack:{r2Key:'vr-home-a.pdf'}}]
  }
},{resourceExists:async()=>true});

const byKey = Object.fromEntries(detail.resources.map(row=>[row.objectKey,row]));
assert.equal(byKey['core-pre.pdf'].presentationGroup,'core-prelesson');
assert.equal(byKey['core-home.pdf'].presentationGroup,'core-homework');
assert.equal(byKey['core-home-a.pdf'].presentationGroup,'core-homework');
assert.equal(byKey['core-home-a.pdf'].protected,true);
assert.equal(byKey['core-cum.pdf'].presentationGroup,'core-cumulative');
assert.equal(byKey['11-pre.pdf'].presentationGroup,'elevenplus-prelesson');
assert.deepEqual(byKey['11-pre.pdf'].presentationScopes,['elevenPlus']);
assert.equal(byKey['11-home-a.pdf'].presentationGroup,'elevenplus-homework');
assert.equal(byKey['vr-pre.pdf'].presentationGroup,'vr-prelesson');
assert.deepEqual(byKey['vr-pre.pdf'].presentationScopes,['vr']);
assert.equal(byKey['vr-pre-a.pdf'].presentationGroup,'vr-prelesson');
assert.equal(byKey['vr-pre-a.pdf'].protected,true);
assert.equal(byKey['vr-home.pdf'].presentationGroup,'vr-homework');
assert.equal(byKey['vr-home-a.pdf'].presentationGroup,'vr-homework');
assert.equal(byKey['vr-extra-a.pdf'].presentationGroup,'vr-answers');

const runtime = fs.readFileSync(new URL('../rebuild/student/src/lib/runtime.mjs', import.meta.url),'utf8');
assert.match(runtime,/presentationScopes:\s*resourcePresentationScopes\(resource\)/);
assert.match(runtime,/presentationGroup:\s*clean\(resource\.presentationGroup\)/);
console.log('REBUILD_CP12_RESOURCE_PRESENTATION_GROUPS_PASS');
''')
