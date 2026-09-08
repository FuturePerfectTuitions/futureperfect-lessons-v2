import change16Worker from './index-phase20-change16.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { VIEW_CURRICULA } from './phase11-navigation-cache.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const NAV_PATH = '/api/v1/student/navigation';

const VIEW_META = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2', rank:20 },
  'maths-year3': { subject:'maths', label:'Year 3', rank:30 },
  'maths-year4': { subject:'maths', label:'Year 4', rank:40 },
  'maths-year5': { subject:'maths', label:'Year 5', rank:50 },
  'maths-year6': { subject:'maths', label:'Year 6', rank:60 },
  'maths-level1': { subject:'maths', label:'L1', rank:41 },
  'maths-level2': { subject:'maths', label:'L2', rank:51 },
  'maths-level3': { subject:'maths', label:'L3', rank:61 },
  'english-year2': { subject:'english', label:'Year 2', rank:20 },
  'english-year3': { subject:'english', label:'Year 3', rank:30 },
  'english-year4': { subject:'english', label:'Year 4', rank:40 },
  'english-year5': { subject:'english', label:'Year 5', rank:50 },
  'english-year6': { subject:'english', label:'Year 6', rank:60 },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+', rank:41 },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+', rank:51 }
});

const LIBRARY_TO_VIEW = Object.freeze({
  MATHS_Y2_FULL:'maths-year2', MATHS_Y3_FULL:'maths-year3', MATHS_Y4_FULL:'maths-year4',
  MATHS_Y5_FULL:'maths-year5', MATHS_Y6_FULL:'maths-year6',
  MATHS_L1_FULL:'maths-level1', MATHS_L2_FULL:'maths-level2', MATHS_L3_FULL:'maths-level3',
  ENGLISH_Y2_FULL:'english-year2', ENGLISH_Y3_FULL:'english-year3', ENGLISH_Y4_FULL:'english-year4',
  ENGLISH_Y5_FULL:'english-year5', ENGLISH_Y6_FULL:'english-year6',
  ENGLISH_Y4_11PLUS_FULL:'english-year4-11plus', ENGLISH_Y5_11PLUS_FULL:'english-year5-11plus'
});

const COUNTERPART_VIEW = Object.freeze({
  'maths-year2':'english-year2', 'maths-year3':'english-year3', 'maths-year4':'english-year4',
  'maths-year5':'english-year5', 'maths-year6':'english-year6',
  'maths-level1':'english-year4-11plus', 'maths-level2':'english-year5-11plus',
  'english-year2':'maths-year2', 'english-year3':'maths-year3', 'english-year4':'maths-year4',
  'english-year5':'maths-year5', 'english-year6':'maths-year6',
  'english-year4-11plus':'maths-level1', 'english-year5-11plus':'maths-level2'
});

const BUNDLED_ROWS = new Map(
  Object.keys(VIEW_META).map(viewId => [viewId, canonicalCatalogueRowsForView(viewId)])
);

function jsonLike(response, body, status = 200) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status, headers });
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
}

function academicYearStart(today = londonToday()) {
  const match = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  return `${Number(match[2]) >= 9 ? year : year - 1}-09-01`;
}

function viewForDefinition(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year || 0);
  const level = Number(row?.maths_level || 0);
  if (subject === 'maths') {
    if (stream === '11plus' && level >= 1 && level <= 3) return `maths-level${level}`;
    if (stream === 'normal' && year >= 2 && year <= 6) return `maths-year${year}`;
  }
  if (subject === 'english' && year >= 2 && year <= 6) {
    if (stream === '11plus' && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    if (stream === 'normal') return `english-year${year}`;
  }
  return '';
}

function viewForBatchKey(value) {
  const key = clean(value).toUpperCase();
  let match = key.match(/^Y([2-6])M(?:O)?$/);
  if (match) return `maths-year${match[1]}`;
  match = key.match(/^Y([2-6])E(?:O)?$/);
  if (match) return `english-year${match[1]}`;
  match = key.match(/^Y([4-6])(?:11|M11|11M).*$/);
  if (match) return `maths-level${Number(match[1]) - 3}`;
  match = key.match(/^Y([45])(?:E11|11E).*$/);
  if (match) return `english-year${match[1]}-11plus`;
  return '';
}

function assignmentCurrent(row, today) {
  const from = clean(row?.effective_from);
  const to = clean(row?.effective_to);
  const activeFrom = clean(row?.active_from);
  const activeTo = clean(row?.active_to);
  return (!from || from <= today) && (!to || today < to) &&
    (!activeFrom || activeFrom <= today) && (!activeTo || today < activeTo);
}

function curriculumLessonIds(raw) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.lessonIds) ? raw.lessonIds
      : Array.isArray(raw?.lessons) ? raw.lessons
        : Array.isArray(raw?.items) ? raw.items : [];
  return items.map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId)).filter(Boolean);
}

async function liveMembership(env) {
  const codes = [...new Set(Object.values(VIEW_CURRICULA).flat())];
  const pairs = await Promise.all(codes.map(async code => [
    code,
    await env.LESSONS_KV.get(`curriculum:${code}`, { type:'json' }).catch(() => null)
  ]));
  const byCode = new Map(pairs);
  const result = new Map();
  for (const viewId of Object.keys(VIEW_META)) {
    const ids = new Set();
    for (const code of VIEW_CURRICULA[viewId] || []) {
      for (const lessonId of curriculumLessonIds(byCode.get(code))) ids.add(lessonId);
    }
    if (!ids.size) {
      for (const row of BUNDLED_ROWS.get(viewId) || []) ids.add(row.lessonId);
    }
    result.set(viewId, ids);
  }
  return result;
}

async function sessionContext(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await change16Worker.fetch(new Request(url.toString(), {
    method:'GET', headers:request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  const portalUserId = clean(body?.portalUserId || body?.student?.portalUserId);
  return { response, body, portalUserId, portalUserIdNorm:norm(portalUserId) };
}

async function navigationRows(env, portalUserIdNorm) {
  const assignments = env?.DB ? env.DB.prepare(
    `SELECT a.batch_key, a.effective_from, a.effective_to,
            b.subject, b.school_year, b.stream, b.maths_level, b.active_from, b.active_to
       FROM student_batch_assignments a
       JOIN batch_definitions b ON b.batch_key = a.batch_key
      WHERE a.portal_user_id_norm = ?`
  ).bind(portalUserIdNorm).all() : Promise.resolve({ results:[] });

  const full = env?.DB ? env.DB.prepare(
    `SELECT e.lesson_id, e.source_batch_code AS batch_key, e.source_lesson_date AS lesson_date,
            e.first_granted_at, b.subject, b.school_year, b.stream, b.maths_level
       FROM lesson_entitlements e
       LEFT JOIN batch_definitions b ON b.batch_key = e.source_batch_code
      WHERE e.portal_user_id_norm = ? AND e.core_access = 1`
  ).bind(portalUserIdNorm).all() : Promise.resolve({ results:[] });

  const pre = env?.DB ? env.DB.prepare(
    `SELECT e.lesson_id, e.batch_key, e.lesson_date, e.first_granted_at,
            b.subject, b.school_year, b.stream, b.maths_level
       FROM online_prelesson_entitlements e
       LEFT JOIN batch_definitions b ON b.batch_key = e.batch_key
      WHERE e.portal_user_id_norm = ?`
  ).bind(portalUserIdNorm).all() : Promise.resolve({ results:[] });

  const [a, f, p] = await Promise.all([assignments, full, pre]);
  return {
    assignments:Array.isArray(a?.results) ? a.results : [],
    full:Array.isArray(f?.results) ? f.results : [],
    pre:Array.isArray(p?.results) ? p.results : []
  };
}

function addView(map, viewId, source, current = false) {
  if (!VIEW_META[viewId]) return null;
  let item = map.get(viewId);
  if (!item) {
    item = { viewId, source, current:Boolean(current), assignmentSeen:false, fullLibrary:false, openIds:new Set() };
    map.set(viewId, item);
  }
  item.current ||= Boolean(current);
  return item;
}

function buildActualViews(user, rows, membership) {
  const today = londonToday();
  const academicStart = academicYearStart(today);
  const map = new Map();

  for (const library of Array.isArray(user?.fullLibraries) ? user.fullLibraries : []) {
    const viewId = LIBRARY_TO_VIEW[clean(library).toUpperCase()];
    const item = addView(map, viewId, 'fullLibrary', true);
    if (item) item.fullLibrary = true;
  }

  for (const viewId of Array.isArray(user?.trialViews) ? user.trialViews.map(norm) : []) {
    const item = addView(map, viewId, 'trial', true);
    if (item) item.trial = true;
  }

  for (const batch of Array.isArray(user?.batches) ? user.batches : []) {
    addView(map, viewForBatchKey(batch), 'legacyBatch', true);
  }

  for (const row of rows.assignments) {
    const viewId = viewForDefinition(row) || viewForBatchKey(row?.batch_key);
    const item = addView(map, viewId, 'batchAssignment', assignmentCurrent(row, today));
    if (item) item.assignmentSeen = true;
  }

  const accessRows = [
    ...rows.full.map(row => ({ ...row, mode:'full' })),
    ...rows.pre.map(row => ({ ...row, mode:'prelesson' }))
  ];
  for (const row of accessRows) {
    const viewId = viewForDefinition(row) || viewForBatchKey(row?.batch_key);
    const lessonId = clean(row?.lesson_id);
    const current = !clean(row?.lesson_date) || !academicStart || clean(row.lesson_date) >= academicStart;
    const item = addView(map, viewId, 'lessonReleaseEntitlement', current);
    if (item && lessonId && membership.get(viewId)?.has(lessonId)) item.openIds.add(lessonId);
  }

  for (const item of map.values()) {
    if (item.fullLibrary && item.assignmentSeen && !rows.assignments.some(row =>
      (viewForDefinition(row) || viewForBatchKey(row?.batch_key)) === item.viewId && assignmentCurrent(row, today)
    )) item.current = false;
  }

  return { map, accessRows };
}

function viewSummary(item, membership) {
  const meta = VIEW_META[item.viewId];
  const visible = membership.get(item.viewId)?.size || (BUNDLED_ROWS.get(item.viewId) || []).length;
  const open = item.fullLibrary || item.trial ? visible : Math.min(visible, item.openIds.size);
  return {
    viewId:item.viewId,
    subject:meta.subject,
    label:meta.label,
    catalogueAvailable:visible > 0,
    visibleLessonCount:visible,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, visible - open),
    lockedPreview:false,
    current:item.current,
    group:item.current ? 'current' : 'previous',
    source:item.source
  };
}

function previewSummary(viewId, membership) {
  const meta = VIEW_META[viewId];
  const visible = membership.get(viewId)?.size || (BUNDLED_ROWS.get(viewId) || []).length;
  return {
    viewId, subject:meta.subject, label:meta.label,
    catalogueAvailable:visible > 0,
    visibleLessonCount:visible, openLessonCount:0, lockedLessonCount:visible,
    lockedPreview:true, current:true, group:'current', source:'crossSubjectPreview'
  };
}

function buildSubjects(actual, membership) {
  const subjects = [
    { subject:'maths', label:'Maths', views:[] },
    { subject:'english', label:'English', views:[] }
  ];
  const bySubject = new Map(subjects.map(subject => [subject.subject, subject]));

  for (const item of actual.values()) {
    const summary = viewSummary(item, membership);
    bySubject.get(summary.subject)?.views.push(summary);
  }

  for (const target of ['maths','english']) {
    const targetSubject = bySubject.get(target);
    if (targetSubject.views.length) continue;
    const source = target === 'maths' ? bySubject.get('english') : bySubject.get('maths');
    const seen = new Set();
    for (const sourceView of source.views) {
      const counterpart = COUNTERPART_VIEW[sourceView.viewId];
      if (!counterpart || VIEW_META[counterpart]?.subject !== target || seen.has(counterpart)) continue;
      seen.add(counterpart);
      targetSubject.views.push(previewSummary(counterpart, membership));
    }
  }

  for (const subject of subjects) {
    subject.views.sort((a, b) => VIEW_META[a.viewId].rank - VIEW_META[b.viewId].rank || a.viewId.localeCompare(b.viewId));
  }
  return subjects;
}

function bundledRow(viewId, lessonId) {
  return (BUNDLED_ROWS.get(viewId) || []).find(row => row.lessonId === lessonId) || null;
}

function recentShares(accessRows) {
  return accessRows
    .filter(row => clean(row?.first_granted_at) && clean(row?.lesson_id))
    .sort((a, b) => clean(b.first_granted_at).localeCompare(clean(a.first_granted_at)))
    .slice(0, 20)
    .map(row => {
      const viewId = viewForDefinition(row) || viewForBatchKey(row?.batch_key);
      const canonical = bundledRow(viewId, clean(row.lesson_id));
      if (!VIEW_META[viewId]) return null;
      return {
        lessonId:clean(row.lesson_id),
        displayLessonId:clean(canonical?.displayLessonId || row.lesson_id),
        title:clean(canonical?.title || row.lesson_id),
        subject:VIEW_META[viewId].subject,
        viewId,
        viewLabel:VIEW_META[viewId].label,
        accessMode:row.mode,
        accessLabel:row.mode === 'prelesson' ? 'PreLesson Sheets only' : 'Full lesson',
        sharedAt:clean(row.first_granted_at),
        lessonDate:clean(row.lesson_date),
        clickable:true
      };
    })
    .filter(Boolean);
}

async function fastNavigation(request, env, ctx) {
  const session = await sessionContext(request, env, ctx);
  if (!session.response.ok || !session.body?.ok || !session.portalUserIdNorm) return session.response;
  if (!env?.STUDENTS_KV || !env?.LESSONS_KV || !env?.DB) {
    return jsonLike(session.response, { error:'NAVIGATION_UNAVAILABLE' }, 503);
  }

  const [user, membership, rows] = await Promise.all([
    env.STUDENTS_KV.get(`user:${session.portalUserIdNorm}`, { type:'json' }),
    liveMembership(env),
    navigationRows(env, session.portalUserIdNorm)
  ]);
  if (!user) return jsonLike(session.response, { error:'STUDENT_NOT_FOUND' }, 404);

  const { map:actual, accessRows } = buildActualViews(user, rows, membership);
  return jsonLike(session.response, {
    ok:true,
    student:{
      portalUserId:session.portalUserId,
      firstName:session.body?.firstName || session.body?.student?.firstName || ''
    },
    subjects:buildSubjects(actual, membership),
    recentShares:recentShares(accessRows),
    navigationMode:'fast-v1'
  });
}

export { NAV_PATH, viewForDefinition, viewForBatchKey, fastNavigation };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === NAV_PATH) {
      return fastNavigation(request, env, ctx);
    }
    return change16Worker.fetch(request, env, ctx);
  }
};
