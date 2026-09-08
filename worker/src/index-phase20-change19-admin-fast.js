import adminSuperuserWorker from './index-phase20-change18-admin-superuser.js';
import { liveCatalogueForView } from './live-student-catalogue-overlay.js';
import { VIEW_CURRICULA } from './phase11-navigation-cache.js';
import {
  normalisePhase11Resources,
  primaryDownloadResource,
  answerIndexFor
} from './phase11-resources.js';
import {
  presentationForView,
  explicitMainVideo,
  explicitVrVideo,
  explicitQuiz
} from './phase11-screenpal.js';

const clean = value => String(value ?? '').trim();

const VIEW_META = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2' },
  'maths-year3': { subject:'maths', label:'Year 3' },
  'maths-year4': { subject:'maths', label:'Year 4' },
  'maths-year5': { subject:'maths', label:'Year 5' },
  'maths-year6': { subject:'maths', label:'Year 6' },
  'maths-level1': { subject:'maths', label:'L1' },
  'maths-level2': { subject:'maths', label:'L2' },
  'maths-level3': { subject:'maths', label:'L3' },
  'english-year2': { subject:'english', label:'Year 2' },
  'english-year3': { subject:'english', label:'Year 3' },
  'english-year4': { subject:'english', label:'Year 4' },
  'english-year5': { subject:'english', label:'Year 5' },
  'english-year6': { subject:'english', label:'Year 6' },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+' },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+' }
});

function viewScopedRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/student/')) return false;
  if (/^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) return true;
  if (/^\/api\/v1\/student\/lessons\/[^/]+$/.test(url.pathname)) return true;
  if (/^\/api\/v1\/student\/resources\/[^/]+\/(?:download|video|quiz)$/.test(url.pathname)) return true;
  return Boolean(clean(url.searchParams.get('viewId')));
}

function lessonListViewId(request) {
  if (request.method !== 'GET') return '';
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim().toLowerCase(); } catch { return ''; }
}

function lessonDetailId(request) {
  if (request.method !== 'GET') return '';
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim(); } catch { return ''; }
}

function requestedViewId(request) {
  return clean(new URL(request.url).searchParams.get('viewId')).toLowerCase();
}

async function authenticatedAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await adminSuperuserWorker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  return Boolean(
    response.ok &&
    body?.ok &&
    body?.superuser === true &&
    String(body?.role || '').toLowerCase() === 'admin'
  );
}

function fastPathEnv(env) {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'ADMIN_SUPERUSER_FAST_PATH') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
  if (!origin || !allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
    Vary: 'Origin'
  };
}

function json(body, request, env, status = 200) {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function makeResourceKey(lessonId, kind, index) {
  return `${encodeURIComponent(String(lessonId))}~${kind}~${index}`;
}

function parseResourceKey(value) {
  const parts = String(value || '').split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try { lessonId = decodeURIComponent(parts[0]); } catch { return null; }
  const kind = clean(parts[1]);
  const index = Number(parts[2]);
  if (!lessonId || !kind || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, kind, index };
}

function resourceMatch(request, suffix) {
  const pattern = new RegExp(`^/api/v1/student/resources/([^/]+)/${suffix}$`);
  const match = new URL(request.url).pathname.match(pattern);
  if (!match) return null;
  try { return parseResourceKey(decodeURIComponent(match[1])); } catch { return null; }
}

function displayIdForView(record, viewId) {
  for (const source of [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const direct = clean(source[viewId]);
    if (direct) return direct;
    const match = Object.entries(source).find(([key]) => String(key).toLowerCase() === String(viewId).toLowerCase());
    if (match && clean(match[1])) return clean(match[1]);
  }
  return clean(record?.lessonId);
}

function cleanStudentTitle(record, shownId) {
  let title = clean(record?.title);
  const canonical = clean(record?.lessonId);
  for (const prefix of [canonical, shownId]) {
    if (!prefix) continue;
    const marker = `${prefix} `;
    if (title.toLowerCase().startsWith(marker.toLowerCase())) title = title.slice(marker.length).trim();
  }
  return title || shownId || canonical;
}

function lessonCollections(record) {
  const core = record?.core || {};
  return {
    preLessonSheets: Array.isArray(record?.preLessonSheets)
      ? record.preLessonSheets
      : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []),
    homeworks: Array.isArray(record?.homeworks)
      ? record.homeworks
      : (Array.isArray(core.homeworks) ? core.homeworks : []),
    otherResources: Array.isArray(record?.otherResources)
      ? record.otherResources
      : (Array.isArray(core.otherResources) ? core.otherResources : [])
  };
}

function rawFile(item, fallbackName) {
  if (!item || typeof item !== 'object') return null;
  const r2Key = clean(item.r2Key || item.r2);
  if (!r2Key) return null;
  return {
    displayName: clean(item.displayName || item.name) || fallbackName,
    r2Key
  };
}

function openFile(item, fallbackName, lessonId, kind, index) {
  const file = rawFile(item, fallbackName);
  if (!file) return null;
  return {
    displayName: file.displayName,
    resourceKey: makeResourceKey(lessonId, kind, index),
    available: true,
    locked: false,
    protected: false,
    passwordRequired: false
  };
}

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function curriculumLessonIds(raw) {
  return rawCatalogueItems(raw)
    .map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId))
    .filter(Boolean);
}

async function lessonBelongsToView(env, lessonId, viewId) {
  const codes = VIEW_CURRICULA[viewId] || [];
  if (!codes.length) return false;
  const curricula = await Promise.all(codes.map(code =>
    env.LESSONS_KV.get(`curriculum:${code}`, { type:'json' }).catch(() => null)
  ));
  return curricula.some(curriculum => curriculumLessonIds(curriculum).includes(lessonId));
}

async function directAdminLessonList(request, env, viewId) {
  const meta = VIEW_META[viewId];
  if (!meta) return json({ error:'VIEW_NOT_AVAILABLE' }, request, env, 404);

  const rows = await liveCatalogueForView(env, viewId);
  if (!rows.length) {
    return json({ error:'ADMIN_CATALOGUE_UNAVAILABLE' }, request, env, 503);
  }

  const lessons = rows.map(row => ({
    lessonId: row.lessonId,
    displayLessonId: row.displayLessonId,
    title: row.title,
    description: row.description || '',
    state: 'open',
    locked: false,
    blocked: false,
    preview: false,
    missedPreview: false,
    accessMode: 'admin-superuser',
    accessMessage: ''
  }));

  return json({
    ok: true,
    superuser: true,
    role: 'admin',
    view: {
      viewId,
      subject: meta.subject,
      label: meta.label,
      presentation: presentationForView(viewId),
      catalogueAvailable: true,
      visibleLessonCount: lessons.length,
      openLessonCount: lessons.length,
      lockedLessonCount: 0,
      lockedPreview: false,
      current: true,
      group: 'current',
      source: 'adminSuperuserDirect'
    },
    lessons
  }, request, env, 200);
}

function directVrModel(record, lessonId, viewId) {
  if (!/^english-year[45]-11plus$/.test(viewId)) return null;
  const vr = record?.vr;
  if (!vr || typeof vr !== 'object') return null;

  const pre = Array.isArray(vr.preLesson) ? vr.preLesson : [];
  const homeworks = Array.isArray(vr.homeworks) ? vr.homeworks : [];
  const preLesson = pre.map((item, offset) => {
    const index = offset + 1;
    const sheet = item?.sheet || ((item?.r2Key || item?.r2) ? item : null);
    return {
      sheet: openFile(sheet, `VR PreLesson Sheet ${index}`, lessonId, 'vrpre', index),
      answerKey: openFile(item?.answerKey, `VR PreLesson Answer Key ${index}`, lessonId, 'answer', 1000 + index)
    };
  }).filter(pair => pair.sheet || pair.answerKey);

  const homeworkPairs = homeworks.map((item, offset) => {
    const index = offset + 1;
    const homework = item?.homework || ((item?.r2Key || item?.r2) ? item : null);
    return {
      homework: openFile(homework, `VR Homework ${index}`, lessonId, 'vrhomework', index),
      answerPack: openFile(item?.answerPack, `VR Homework Answer Pack ${index}`, lessonId, 'answer', 2000 + index)
    };
  }).filter(pair => pair.homework || pair.answerPack);

  const preVideo = explicitVrVideo(record, 'vrprevideo');
  const homeworkVideo = explicitVrVideo(record, 'vrhomeworkvideo');
  if (!preLesson.length && !homeworkPairs.length && !preVideo && !homeworkVideo) return null;

  return {
    preLesson,
    preLessonVideo: preVideo ? {
      displayName:'VR PreLesson Video',
      resourceKey:makeResourceKey(lessonId, 'vrprevideo', 1),
      locked:false
    } : null,
    homeworks: homeworkPairs,
    homeworkVideo: homeworkVideo ? {
      displayName:'VR Homework Solution Video',
      resourceKey:makeResourceKey(lessonId, 'vrhomeworkvideo', 1),
      locked:false
    } : null
  };
}

function extensionPair(pair, lessonId, kind, answerCategory, index) {
  if (!pair) return null;
  const primary = pair.primary?.r2Key ? {
    displayName:pair.primary.displayName,
    resourceKey:makeResourceKey(lessonId, kind, index),
    available:true,
    locked:false,
    protected:false,
    passwordRequired:false
  } : null;
  const answerIndex = answerIndexFor(answerCategory, index);
  const answerPack = pair.answerPack?.r2Key && answerIndex ? {
    displayName:pair.answerPack.displayName,
    resourceKey:makeResourceKey(lessonId, 'answer', answerIndex),
    available:true,
    locked:false,
    protected:false,
    passwordRequired:false
  } : null;
  return primary || answerPack ? { primary, answerPack } : null;
}

function extensionPairs(values, lessonId, kind, answerCategory) {
  return (Array.isArray(values) ? values : [])
    .map((pair, offset) => extensionPair(pair, lessonId, kind, answerCategory, offset + 1))
    .filter(Boolean);
}

function extensionAnswers(values, lessonId, answerCategory) {
  return (Array.isArray(values) ? values : []).map((answer, offset) => {
    if (!answer?.r2Key) return null;
    const answerIndex = answerIndexFor(answerCategory, offset + 1);
    if (!answerIndex) return null;
    return {
      displayName:answer.displayName,
      resourceKey:makeResourceKey(lessonId, 'answer', answerIndex),
      available:true,
      locked:false,
      protected:false,
      passwordRequired:false
    };
  });
}

function directPhase11Model(record, lessonId, viewId, vrModel) {
  const source = normalisePhase11Resources(record);
  const presentation = presentationForView(viewId);
  const corePreLessonPairs = extensionPairs(source.core.preLessonPairs, lessonId, 'p11corepre', 'corePreLesson');
  const coreCumulativeHomeworks = extensionPairs(source.core.cumulativeHomeworks, lessonId, 'p11corecum', 'coreCumulative');
  const coreSupplementaryAnswers = extensionAnswers(source.core.supplementaryAnswers, lessonId, 'coreSupplementary');

  const elevenPlus = presentation === '11plus' ? {
    preLessonPairs:extensionPairs(source.elevenPlus.preLessonPairs, lessonId, 'p11elevenpre', 'elevenPlusPreLesson'),
    homeworks:extensionPairs(source.elevenPlus.homeworks, lessonId, 'p11elevenhw', 'elevenPlusHomework'),
    cumulativeHomeworks:extensionPairs(source.elevenPlus.cumulativeHomeworks, lessonId, 'p11elevencum', 'elevenPlusCumulative'),
    supplementaryAnswers:extensionAnswers(source.elevenPlus.supplementaryAnswers, lessonId, 'elevenPlusSupplementary')
  } : null;

  const vrSupplementaryAnswers = vrModel
    ? extensionAnswers(source.vr.supplementaryAnswers, lessonId, 'vrSupplementary')
    : [];

  const hasContent = Boolean(
    corePreLessonPairs.length || coreCumulativeHomeworks.length || coreSupplementaryAnswers.some(Boolean) ||
    elevenPlus?.preLessonPairs.length || elevenPlus?.homeworks.length || elevenPlus?.cumulativeHomeworks.length ||
    elevenPlus?.supplementaryAnswers.some(Boolean) || vrSupplementaryAnswers.some(Boolean)
  );
  if (!hasContent) return null;
  return {
    corePreLessonPairs,
    coreCumulativeHomeworks,
    coreSupplementaryAnswers,
    elevenPlus,
    vrSupplementaryAnswers
  };
}

async function directAdminLessonDetail(request, env, lessonId, viewId) {
  const meta = VIEW_META[viewId];
  if (!meta) return json({ error:'VIEW_NOT_AVAILABLE' }, request, env, 404);

  const [record, belongs] = await Promise.all([
    env.LESSONS_KV.get(`lesson:${lessonId}`, { type:'json' }).catch(() => null),
    lessonBelongsToView(env, lessonId, viewId)
  ]);
  if (!record || record.active === false || !belongs) {
    return json({ error:'LESSON_NOT_FOUND' }, request, env, 404);
  }

  const shownId = displayIdForView(record, viewId);
  const collections = lessonCollections(record);
  const preLessonSheets = collections.preLessonSheets
    .map((item, offset) => openFile(
      item,
      collections.preLessonSheets.length > 1 ? `PreLesson Sheet ${offset + 1}` : 'PreLesson Sheet',
      lessonId,
      'pre',
      offset + 1
    ))
    .filter(Boolean);

  const homeworks = collections.homeworks.map((pair, offset) => {
    const index = offset + 1;
    const homework = pair?.homework || ((pair?.r2Key || pair?.r2) ? pair : null);
    return {
      pairKey:`${encodeURIComponent(lessonId)}~pair~${index}`,
      homework:openFile(homework, collections.homeworks.length > 1 ? `Homework ${index}` : 'Homework', lessonId, 'homework', index),
      answerPack:openFile(pair?.answerPack, collections.homeworks.length > 1 ? `Answer Pack ${index}` : 'Answer Pack', lessonId, 'answer', index)
    };
  }).filter(pair => pair.homework || pair.answerPack);

  const otherResources = collections.otherResources
    .map((item, offset) => openFile(
      item,
      collections.otherResources.length > 1 ? `Resource ${offset + 1}` : 'Resource',
      lessonId,
      'other',
      offset + 1
    ))
    .filter(Boolean);

  const mainVideo = explicitMainVideo(record, viewId);
  const presentation = presentationForView(viewId);
  const quiz = presentation === '11plus' ? explicitQuiz(record) : null;
  const vr = directVrModel(record, lessonId, viewId);

  const lesson = {
    lessonId:clean(record.lessonId) || lessonId,
    displayLessonId:shownId,
    title:cleanStudentTitle(record, shownId),
    description:clean(record.description || record.desc),
    subject:clean(record.subject) || meta.subject,
    state:'open',
    locked:false,
    blocked:false,
    preview:false,
    missedPreview:false,
    accessMode:'admin-superuser',
    accessMessage:'',
    presentation,
    preLessonSheets,
    video:mainVideo ? {
      displayName:'Video',
      resourceKey:makeResourceKey(lessonId, 'video', 1),
      locked:false
    } : null,
    homeworks,
    otherResources,
    quiz:quiz ? {
      displayName:quiz.displayName || 'ScreenPal Quiz',
      resourceKey:makeResourceKey(lessonId, 'quiz', 1),
      locked:false
    } : null,
    vr
  };
  lesson.phase11Resources = directPhase11Model(record, lessonId, viewId, vr);

  return json({
    ok:true,
    superuser:true,
    role:'admin',
    view:{
      viewId,
      subject:meta.subject,
      label:meta.label,
      presentation,
      lockedPreview:false,
      current:true,
      group:'current',
      source:'adminSuperuserDirect'
    },
    lesson,
    timestamp:new Date().toISOString()
  }, request, env, 200);
}

function coreDownloadResource(record, parsed) {
  const collections = lessonCollections(record);
  if (parsed.kind === 'pre') {
    return rawFile(collections.preLessonSheets[parsed.index - 1], 'PreLesson Sheet');
  }
  if (parsed.kind === 'homework') {
    const pair = collections.homeworks[parsed.index - 1];
    const source = pair?.homework || ((pair?.r2Key || pair?.r2) ? pair : null);
    return rawFile(source, 'Homework');
  }
  if (parsed.kind === 'other') {
    return rawFile(collections.otherResources[parsed.index - 1], 'Resource');
  }
  if (parsed.kind === 'vrpre') {
    const item = Array.isArray(record?.vr?.preLesson) ? record.vr.preLesson[parsed.index - 1] : null;
    return rawFile(item?.sheet || ((item?.r2Key || item?.r2) ? item : null), 'VR PreLesson Sheet');
  }
  if (parsed.kind === 'vrhomework') {
    const item = Array.isArray(record?.vr?.homeworks) ? record.vr.homeworks[parsed.index - 1] : null;
    return rawFile(item?.homework || ((item?.r2Key || item?.r2) ? item : null), 'VR Homework');
  }
  if (['p11corepre','p11corecum','p11elevenpre','p11elevenhw','p11elevencum'].includes(parsed.kind)) {
    return primaryDownloadResource(record, parsed.kind, parsed.index);
  }
  return null;
}

function safeFilename(value, fallback = 'resource.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

async function directAdminDownload(request, env, parsed) {
  if (!parsed) return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  const record = await env.LESSONS_KV.get(`lesson:${parsed.lessonId}`, { type:'json' }).catch(() => null);
  if (!record || record.active === false) return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  const resource = coreDownloadResource(record, parsed);
  if (!resource?.r2Key) return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object?.body) return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  const headers = new Headers(corsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${safeFilename(resource.displayName)}"`);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status:200, headers });
}

async function directAdminVideo(request, env, parsed, viewId) {
  if (!parsed) return json({ error:'VIDEO_NOT_FOUND' }, request, env, 404);
  const record = await env.LESSONS_KV.get(`lesson:${parsed.lessonId}`, { type:'json' }).catch(() => null);
  if (!record || record.active === false) return json({ error:'VIDEO_NOT_FOUND' }, request, env, 404);

  let target = null;
  let displayName = 'Video';
  if (parsed.kind === 'video' && parsed.index === 1) {
    target = explicitMainVideo(record, viewId);
  } else if (parsed.kind === 'vrprevideo' && parsed.index === 1) {
    target = explicitVrVideo(record, 'vrprevideo');
    displayName = 'VR PreLesson Video';
  } else if (parsed.kind === 'vrhomeworkvideo' && parsed.index === 1) {
    target = explicitVrVideo(record, 'vrhomeworkvideo');
    displayName = 'VR Homework Solution Video';
  }
  if (!target?.embedUrl) return json({ error:'VIDEO_NOT_FOUND' }, request, env, 404);
  return json({ ok:true, displayName, embedUrl:target.embedUrl, superuser:true }, request, env, 200);
}

async function directAdminQuiz(request, env, parsed) {
  if (!parsed || parsed.kind !== 'quiz' || parsed.index !== 1) {
    return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  }
  const record = await env.LESSONS_KV.get(`lesson:${parsed.lessonId}`, { type:'json' }).catch(() => null);
  if (!record || record.active === false) return json({ error:'RESOURCE_NOT_FOUND' }, request, env, 404);
  const target = explicitQuiz(record);
  if (!target?.url) return json({ error:'QUIZ_NOT_FOUND' }, request, env, 404);
  return json({
    ok:true,
    displayName:target.displayName,
    mode:target.mode,
    url:target.url,
    superuser:true
  }, request, env, 200);
}

export default {
  async fetch(request, env, ctx) {
    if (!viewScopedRequest(request)) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    // Never trust a client-supplied marker. First prove, through the normal
    // authenticated session path, that this browser session is the server-side
    // Admin superuser.
    if (!(await authenticatedAdmin(request, env, ctx))) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    const viewId = requestedViewId(request);

    // Admin does not need student entitlement reconstruction for a lesson list.
    // Read only the one requested live curriculum and its lesson records, then
    // mark those rows open.
    const listViewId = lessonListViewId(request);
    if (listViewId) return directAdminLessonList(request, env, listViewId);

    // Lesson detail is also served directly. The previous route still entered
    // Phase 7/8/9 visibility checks, and those checks recursively rebuilt a lesson
    // list through the student-access worker. That is why the UI could remain on
    // "Loading lesson..." even after the lesson-list fast path was fixed.
    const detailId = lessonDetailId(request);
    if (detailId) return directAdminLessonDetail(request, env, detailId, viewId);

    const download = resourceMatch(request, 'download');
    if (download) {
      // Change 18 already has a direct Admin Answer Pack resolver that bypasses
      // the student password flow. Keep using that path for answer resource keys.
      if (download.kind === 'answer') return adminSuperuserWorker.fetch(request, fastPathEnv(env), ctx);
      return directAdminDownload(request, env, download);
    }

    const video = resourceMatch(request, 'video');
    if (video) return directAdminVideo(request, env, video, viewId);

    const quiz = resourceMatch(request, 'quiz');
    if (quiz) return directAdminQuiz(request, env, quiz);

    return adminSuperuserWorker.fetch(request, fastPathEnv(env), ctx);
  }
};
