from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'Expected pattern missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Backend: include immutable first-grant timestamps in release-derived access rows.
replace_once(
    'worker/src/index-phase20-change8.js',
    "SELECT lesson_id, vr_access, source_batch_code, source_lesson_date\n       FROM lesson_entitlements",
    "SELECT lesson_id, vr_access, source_batch_code, source_lesson_date, first_granted_at\n       FROM lesson_entitlements"
)
replace_once(
    'worker/src/index-phase20-change8.js',
    "SELECT lesson_id, vr_access, batch_key, lesson_date\n       FROM online_prelesson_entitlements",
    "SELECT lesson_id, vr_access, batch_key, lesson_date, first_granted_at\n       FROM online_prelesson_entitlements"
)
replace_once(
    'worker/src/index-phase20-change8.js',
    "      batchKey: clean(row.source_batch_code),\n      lessonDate: clean(row.source_lesson_date)\n",
    "      batchKey: clean(row.source_batch_code),\n      lessonDate: clean(row.source_lesson_date),\n      sharedAt: clean(row.first_granted_at)\n"
)
replace_once(
    'worker/src/index-phase20-change8.js',
    "      batchKey: clean(row.batch_key),\n      lessonDate: clean(row.lesson_date)\n",
    "      batchKey: clean(row.batch_key),\n      lessonDate: clean(row.lesson_date),\n      sharedAt: clean(row.first_granted_at)\n"
)

helper_anchor = "function fullLibraryForView(viewId) {\n"
helper_code = r'''function displayLessonIdForView(lesson, viewId) {
  const id = norm(viewId);
  for (const source of [lesson?.displayIds, lesson?.displayLessonIds, lesson?.presentation?.displayIds]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const exact = clean(source[viewId]);
    if (exact) return exact;
    const matchedKey = Object.keys(source).find(key => norm(key) === id);
    if (matchedKey && clean(source[matchedKey])) return clean(source[matchedKey]);
  }
  return clean(lesson?.lessonId);
}

function recentShareItems(accessRows, limit = 20) {
  return accessRows
    .filter(row => row?.lesson && row?.viewId && row?.sharedAt)
    .sort((a, b) => String(b.sharedAt).localeCompare(String(a.sharedAt)))
    .slice(0, Math.max(1, Number(limit) || 20))
    .map(row => ({
      lessonId:row.lessonId,
      displayLessonId:displayLessonIdForView(row.lesson, row.viewId),
      title:clean(row.lesson?.title) || displayLessonIdForView(row.lesson, row.viewId),
      subject:viewSubject(row.viewId),
      viewId:row.viewId,
      viewLabel:viewLabel(row.viewId),
      accessMode:row.mode,
      accessLabel:row.mode === 'prelesson' ? 'PreLesson Sheets only' : 'Full lesson',
      sharedAt:row.sharedAt,
      lessonDate:row.lessonDate
    }));
}

'''
replace_once('worker/src/index-phase20-change8.js', helper_anchor, helper_code + helper_anchor)
replace_once(
    'worker/src/index-phase20-change8.js',
    "  const accessRows = await resolvedAccessRows(env, portalUserIdNorm);\n  if (!accessRows.length) return response;\n  const grouped = new Map();\n",
    "  const accessRows = await resolvedAccessRows(env, portalUserIdNorm);\n  body.recentShares = recentShareItems(accessRows);\n  if (!accessRows.length) return jsonLike(response, body);\n  const grouped = new Map();\n"
)
replace_once(
    'worker/src/index-phase20-change8.js',
    "  currentFromDates\n};\n",
    "  currentFromDates,\n  displayLessonIdForView,\n  recentShareItems\n};\n"
)

# Importer: repeated PRELESSON_ONLY confirmation must not look newly shared.
replace_once(
    'worker/src/admin-lesson-release-import.js',
    "    env.DB.prepare(`SELECT batch_key FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ? LIMIT 1`)\n",
    "    env.DB.prepare(`SELECT batch_key, first_granted_at FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ? LIMIT 1`)\n"
)
replace_once(
    'worker/src/admin-lesson-release-import.js',
    "  return { full:Number(full?.core_access) === 1, pre:Boolean(pre) };\n",
    "  return { full:Number(full?.core_access) === 1, pre:Boolean(pre), preFirstGrantedAt:clean(pre?.first_granted_at) };\n"
)
replace_once(
    'worker/src/admin-lesson-release-import.js',
    "    item.syncRowId,\n    now,\n    now\n  );\n\n  await env.DB.batch([clearExisting, insert]);\n",
    "    item.syncRowId,\n    access.preFirstGrantedAt || now,\n    now\n  );\n\n  await env.DB.batch([clearExisting, insert]);\n"
)

# Home screen markup: recent releases appear above Maths / English.
replace_once(
    'phase11.html',
    '<p class="phase5-subject-intro">Choose a subject to continue.</p><div class="phase5-subject-grid">',
    '<p class="phase5-subject-intro">Choose a subject to continue.</p><section id="recent-shares-panel" class="phase20-recent-shares" aria-labelledby="recent-shares-heading" hidden><div class="phase20-recent-shares-heading"><div><span class="phase7-kicker">Latest updates</span><h2 id="recent-shares-heading">Just shared with you</h2></div></div><div id="recent-shares-list" class="phase20-recent-shares-list"></div></section><div class="phase5-subject-grid">'
)
replace_once(
    'phase11.html',
    '<link rel="stylesheet" href="assets/site-chrome.css">',
    '<link rel="stylesheet" href="assets/site-chrome.css">\n  <link rel="stylesheet" href="assets/phase20-recent-collapse.css">'
)
replace_once(
    'phase11.html',
    '<script src="assets/phase16-ui-refinement.js"></script>',
    '<script src="assets/phase16-ui-refinement.js"></script>\n  <script src="assets/phase20-collapsible-lessons.js"></script>'
)

# SPA controller: render recent shares and open them directly in their proper view.
replace_once(
    'assets/phase7.js',
    "    subjectsMessage: document.getElementById('phase7-message'),\n",
    "    subjectsMessage: document.getElementById('phase7-message'),\n    recentSharesPanel: document.getElementById('recent-shares-panel'),\n    recentSharesList: document.getElementById('recent-shares-list'),\n"
)
replace_once(
    'assets/phase7.js',
    "  function setSubjectsMessage(message = '') {\n    els.subjectsMessage.textContent = message;\n    els.subjectsMessage.hidden = !message;\n  }\n",
    r'''  function setSubjectsMessage(message = '') {
    els.subjectsMessage.textContent = message;
    els.subjectsMessage.hidden = !message;
  }

  function formatSharedDate(value) {
    const date = new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      day:'numeric', month:'short', year:'numeric', timeZone:'Europe/London'
    }).format(date);
  }

  function sharedLessonLabel(item) {
    const code = String(item?.displayLessonId || item?.lessonId || '').trim();
    const title = String(item?.title || '').trim();
    if (!code) return title || 'Lesson';
    if (!title || title.toLowerCase().startsWith(code.toLowerCase())) return title || code;
    return `${code} ${title}`;
  }

  function renderRecentShares(items = []) {
    if (!els.recentSharesPanel || !els.recentSharesList) return;
    els.recentSharesList.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    els.recentSharesPanel.hidden = rows.length === 0;
    if (!rows.length) return;

    for (const item of rows) {
      const row = document.createElement('article');
      row.className = 'phase20-recent-share-row';

      const link = document.createElement('a');
      link.className = 'phase20-recent-share-link';
      link.href = `#shared-${encodeURIComponent(String(item.viewId || ''))}-${encodeURIComponent(String(item.lessonId || ''))}`;
      link.textContent = sharedLessonLabel(item);
      link.addEventListener('click', event => {
        event.preventDefault();
        openSharedLesson(item);
      });

      const meta = document.createElement('div');
      meta.className = 'phase20-recent-share-meta';
      const access = document.createElement('span');
      access.className = `phase20-recent-share-access ${item.accessMode === 'prelesson' ? 'prelesson' : 'full'}`;
      access.textContent = String(item.accessLabel || (item.accessMode === 'prelesson' ? 'PreLesson Sheets only' : 'Full lesson'));
      const dateText = formatSharedDate(item.sharedAt);
      const date = document.createElement('span');
      date.textContent = dateText ? `Shared ${dateText}` : 'Recently shared';
      meta.appendChild(access);
      meta.appendChild(date);

      row.appendChild(link);
      row.appendChild(meta);
      els.recentSharesList.appendChild(row);
    }
  }
'''
)
replace_once(
    'assets/phase7.js',
    "      state.home = body;\n      return body;\n",
    "      state.home = body;\n      renderRecentShares(body.recentShares);\n      return body;\n"
)
replace_once(
    'assets/phase7.js',
    "    els.otherList.innerHTML = '';\n  }\n\n  function resetNavigation() {\n",
    "    els.otherList.innerHTML = '';\n  }\n\n  function resetRecentShares() {\n    if (els.recentSharesList) els.recentSharesList.innerHTML = '';\n    if (els.recentSharesPanel) els.recentSharesPanel.hidden = true;\n  }\n\n  function resetNavigation() {\n"
)
replace_once(
    'assets/phase7.js',
    "    state.lessons = [];\n    els.viewGrid.innerHTML = '';\n",
    "    state.lessons = [];\n    resetRecentShares();\n    els.viewGrid.innerHTML = '';\n"
)

open_anchor = "  async function openView(viewSummary) {\n"
open_shared = r'''  async function openSharedLesson(item) {
    recordActivity();
    if (!state.home) {
      const home = await loadHome();
      if (!home) return;
    }

    const subjectKey = String(item?.subject || '').toLowerCase();
    const subjectLabel = subjectKey === 'english' ? 'English' : 'Maths';
    const subject = subjectFromHome(subjectKey);
    const viewSummary = (Array.isArray(subject.views) ? subject.views : [])
      .find(view => String(view?.viewId || '').toLowerCase() === String(item?.viewId || '').toLowerCase()) || {
        viewId:String(item?.viewId || ''),
        label:String(item?.viewLabel || 'Lessons'),
        subject:subjectKey,
        catalogueAvailable:true
      };

    if (!viewSummary.viewId || !item?.lessonId) return;
    state.subjectKey = subjectKey;
    state.subjectLabel = subjectLabel;
    resetLessonPanel();
    showPortalScreen('lesson');
    els.lessonLoading.hidden = false;

    const body = await fetchViewLessons(viewSummary);
    if (!body) {
      els.lessonLoading.hidden = true;
      els.lessonError.textContent = 'This lesson is temporarily unavailable. Please try again.';
      els.lessonError.hidden = false;
      return;
    }

    state.view = body.view || viewSummary;
    state.lessons = Array.isArray(body.lessons) ? body.lessons : [];
    const listed = state.lessons.find(lesson => String(lesson?.lessonId || '') === String(item.lessonId));
    if (!listed || listed.locked) {
      els.lessonLoading.hidden = true;
      els.lessonError.textContent = 'This shared lesson is no longer available.';
      els.lessonError.hidden = false;
      return;
    }

    try {
      const lesson = await fetchLesson(item.lessonId);
      if (lesson) renderLesson(lesson);
    } catch (_) {
      els.lessonLoading.hidden = true;
      els.lessonError.textContent = 'This lesson is temporarily unavailable. Please try again.';
      els.lessonError.hidden = false;
    }
  }

'''
replace_once('assets/phase7.js', open_anchor, open_shared + open_anchor)

# Collapsible UI is deliberately separate from release/access logic.
Path('assets/phase20-collapsible-lessons.js').write_text(r'''(() => {
  'use strict';
  const lessonContent = document.getElementById('lesson-content');
  if (!lessonContent) return;
  let lastLessonCode = '';
  let queued = false;

  function setExpanded(button, body, expanded) {
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? 'Hide' : 'View';
    body.hidden = !expanded;
  }

  function enhanceDescription() {
    const description = document.getElementById('lesson-description');
    if (!description || description.dataset.fptCollapsible === 'true') return;
    const host = description.parentElement;
    if (!host) return;
    description.dataset.fptCollapsible = 'true';
    description.id = 'lesson-description';
    const bar = document.createElement('div');
    bar.className = 'phase20-description-bar';
    const label = document.createElement('span');
    label.textContent = 'Description';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase20-collapse-toggle';
    button.setAttribute('aria-controls', 'lesson-description');
    button.addEventListener('click', () => setExpanded(button, description, button.getAttribute('aria-expanded') !== 'true'));
    bar.appendChild(label);
    bar.appendChild(button);
    host.insertBefore(bar, description);
    setExpanded(button, description, false);
  }

  function enhanceSection(section) {
    if (section.dataset.fptCollapsible === 'true') return;
    const heading = Array.from(section.children).find(child => child.classList?.contains('phase7-section-heading'));
    if (!heading) return;
    section.dataset.fptCollapsible = 'true';

    const body = document.createElement('div');
    body.className = 'phase20-collapse-body';
    const children = Array.from(section.children).filter(child => child !== heading);
    for (const child of children) body.appendChild(child);
    section.appendChild(body);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase20-collapse-toggle';
    button.addEventListener('click', () => setExpanded(button, body, button.getAttribute('aria-expanded') !== 'true'));
    heading.appendChild(button);
    setExpanded(button, body, false);
  }

  function collapseForNewLesson() {
    const code = String(document.getElementById('lesson-code')?.textContent || '').trim();
    if (!code || code === lastLessonCode) return;
    lastLessonCode = code;
    const desc = document.getElementById('lesson-description');
    const descButton = lessonContent.querySelector('.phase20-description-bar .phase20-collapse-toggle');
    if (desc && descButton) setExpanded(descButton, desc, false);
    for (const section of lessonContent.querySelectorAll('.phase7-resource-section[data-fpt-collapsible="true"]')) {
      const button = Array.from(section.querySelectorAll('.phase20-collapse-toggle')).find(candidate => candidate.closest('.phase7-section-heading'));
      const body = Array.from(section.children).find(child => child.classList?.contains('phase20-collapse-body'));
      if (button && body) setExpanded(button, body, false);
    }
  }

  function apply() {
    enhanceDescription();
    lessonContent.querySelectorAll('.phase7-resource-section').forEach(enhanceSection);
    collapseForNewLesson();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }

  new MutationObserver(queue).observe(lessonContent, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['hidden'] });
  queue();
})();
''', encoding='utf-8')

Path('assets/phase20-recent-collapse.css').write_text(r'''.phase20-recent-shares {
  margin: 20px 0 22px;
  padding: 18px;
  border: 1px solid #d9e2f2;
  border-radius: 16px;
  background: #f8faff;
}
.phase20-recent-shares[hidden] { display: none !important; }
.phase20-recent-shares-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.phase20-recent-shares-heading h2 { margin:3px 0 0; color:#012169; font-size:20px; }
.phase20-recent-shares-list { display:grid; gap:8px; max-height:230px; overflow-y:auto; padding-right:5px; }
.phase20-recent-share-row { padding:11px 12px; border:1px solid #e1e7f0; border-radius:12px; background:#fff; }
.phase20-recent-share-link { display:block; color:#012169; font-size:14px; font-weight:850; line-height:1.35; text-decoration:none; }
.phase20-recent-share-link:hover, .phase20-recent-share-link:focus-visible { text-decoration:underline; outline:none; }
.phase20-recent-share-meta { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; margin-top:6px; color:#667085; font-size:12px; }
.phase20-recent-share-access { display:inline-flex; align-items:center; padding:3px 8px; border-radius:999px; font-weight:800; }
.phase20-recent-share-access.prelesson { background:#fff5d9; color:#765000; }
.phase20-recent-share-access.full { background:#eaf7ee; color:#176532; }

.phase20-description-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:16px; padding-top:14px; border-top:1px solid #e4e8ef; color:#012169; font-size:14px; font-weight:900; }
.phase20-collapse-toggle { flex:0 0 auto; min-width:64px; min-height:34px; padding:6px 13px; border:1px solid #012169; border-radius:999px; background:#fff; color:#012169; font:inherit; font-size:12px; font-weight:900; cursor:pointer; }
.phase20-collapse-toggle:hover, .phase20-collapse-toggle:focus-visible { background:#012169; color:#fff; outline:none; }
.phase7-section-heading { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:14px; align-items:center; margin-bottom:0; }
.phase7-section-heading .phase7-kicker, .phase7-section-heading h2 { grid-column:1; }
.phase7-section-heading .phase20-collapse-toggle { grid-column:2; grid-row:1 / span 2; }
.phase20-collapse-body { margin-top:16px; }
.phase20-collapse-body[hidden], #lesson-description[hidden] { display:none !important; }
.phase7-resource-section[data-fpt-collapsible="true"] { padding-top:18px; padding-bottom:18px; }

@media (max-width:760px) {
  .phase20-recent-shares { margin-top:16px; padding:14px; }
  .phase20-recent-shares-list { max-height:210px; }
  .phase20-recent-share-meta { align-items:flex-start; flex-direction:column; gap:5px; }
  .phase20-collapse-toggle { min-width:58px; }
}
''', encoding='utf-8')

# Verification for ordering, view-specific display ID, immutable timestamp semantics and UI hooks.
Path('tests/recent-shares-collapsible-verification.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentShareItems } from '../worker/src/index-phase20-change8.js';

const y5e = { lessonId:'Y5E2', subject:'English', title:'Descriptive Writing Settings and Atmosphere', displayIds:{ 'english-year5':'Y5T1E01', 'english-year5-11plus':'Y5T1EE01' } };
const y3m = { lessonId:'Y3M1', subject:'Maths', title:'Transitioning to Year 3', displayIds:{ 'maths-year3':'Y3T1M01' } };
const shares = recentShareItems([
  { lessonId:'Y3M1', mode:'full', viewId:'maths-year3', sharedAt:'2026-09-06T10:00:00.000Z', lessonDate:'2026-09-07', lesson:y3m },
  { lessonId:'Y5E2', mode:'prelesson', viewId:'english-year5-11plus', sharedAt:'2026-09-07T09:00:00.000Z', lessonDate:'2026-09-07', lesson:y5e }
]);
assert.equal(shares.length, 2);
assert.equal(shares[0].lessonId, 'Y5E2');
assert.equal(shares[0].displayLessonId, 'Y5T1EE01');
assert.equal(shares[0].accessLabel, 'PreLesson Sheets only');
assert.equal(shares[1].accessLabel, 'Full lesson');

const html = readFileSync(new URL('../phase11.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/phase7.js', import.meta.url), 'utf8');
const collapse = readFileSync(new URL('../assets/phase20-collapsible-lessons.js', import.meta.url), 'utf8');
assert.match(html, /Just shared with you/);
assert.match(html, /recent-shares-list/);
assert.match(js, /openSharedLesson/);
assert.match(js, /Shared \$\{dateText\}/);
assert.match(collapse, /Description/);
assert.match(collapse, /phase7-resource-section/);
assert.match(collapse, /button\.textContent = expanded \? 'Hide' : 'View'/);
console.log('Recent shares + collapsible lesson UI verification: PASS');
''', encoding='utf-8')

# Add importer regression assertion: re-confirming the same PreLesson row preserves first_granted_at.
p = Path('tests/admin-lesson-release-import-verification.mjs')
s = p.read_text(encoding='utf-8')
anchor = "assert.equal(db.entitlements.has('pre0101|Y5E2'), false);\n\nconst upgradeRow"
insert = "assert.equal(db.entitlements.has('pre0101|Y5E2'), false);\nconst firstPreGrantedAt = [...db.prelessons.values()][0]?.first_granted_at;\nconst repeatPre = await call('/api/v1/admin/lesson-releases/confirm', { rows:[onlineReady] }, token);\nassert.equal(repeatPre.response.status, 200);\nassert.equal([...db.prelessons.values()][0]?.first_granted_at, firstPreGrantedAt, 'Idempotent PreLesson confirmation must preserve the original shared timestamp');\n\nconst upgradeRow"
if anchor not in s:
    raise SystemExit('Importer test insertion anchor missing')
p.write_text(s.replace(anchor, insert, 1), encoding='utf-8')

print('Scoped recent-shares/collapsible patch applied.')
