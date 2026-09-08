import assert from 'node:assert/strict';
import { repairLiveStudentCatalogueResponse } from '../worker/src/live-student-catalogue-overlay.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function makeEnv({ fullBatch = 'Y411FM', fullLibraries = [], blockedLessons = [] } = {}) {
  const kv = new Map([
    ['curriculum:MATHS_L1', { curriculumCode:'MATHS_L1', lessonIds:['Y4M2','Y4M22','Y4M1'] }],
    ['lesson:Y4M2', {
      lessonId:'Y4M2', title:'Number and Place Value 1', subject:'maths', active:true,
      displayIds:{ 'maths-level1':'L1T1M01', 'maths-year4':'Y4T1M01' }
    }],
    ['lesson:Y4M22', {
      lessonId:'Y4M22', title:'Fractions 5', subject:'maths', active:true,
      displayIds:{ 'maths-level1':'L1T2M19', 'maths-year4':'Y4T2M19' }
    }],
    ['lesson:Y4M1', {
      lessonId:'Y4M1', title:'Estimate, Compare & Calculate Money', subject:'maths', active:true,
      displayIds:{ 'maths-level1':'L1T3M22', 'maths-year4':'Y4T3M22' }
    }]
  ]);

  const fullRows = fullBatch == null ? [] : ['Y4M2','Y4M22','Y4M1'].map(lesson_id => ({
    lesson_id,
    source_batch_code:fullBatch
  }));

  return {
    LESSONS_KV: {
      async get(key, options) {
        const value = kv.get(String(key)) ?? null;
        return options?.type === 'json' ? clone(value) : (value == null ? null : JSON.stringify(value));
      }
    },
    STUDENTS_KV: {
      async get(key, options) {
        if (String(key) !== 'user:dha2806') return null;
        const value = { fullLibraries, blockedLessons };
        return options?.type === 'json' ? clone(value) : JSON.stringify(value);
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async all() {
                if (String(sql).includes('FROM lesson_entitlements')) return { results:clone(fullRows) };
                if (String(sql).includes('FROM online_prelesson_entitlements')) return { results:[] };
                return { results:[] };
              }
            };
          }
        };
      }
    }
  };
}

async function baseFetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/student/session') {
    return new Response(JSON.stringify({ ok:true, portalUserId:'dha2806' }), {
      status:200,
      headers:{ 'content-type':'application/json' }
    });
  }
  throw new Error(`Unexpected internal request: ${url.pathname}`);
}

function staleResponse() {
  return new Response(JSON.stringify({
    ok:true,
    view:{
      viewId:'maths-level1', visibleLessonCount:4, openLessonCount:3, lockedLessonCount:1
    },
    lessons:[
      { lessonId:'Y4M36', displayLessonId:'L1T1M01', title:'Transition to Level 1', locked:true, state:'locked' },
      { lessonId:'Y4M2', displayLessonId:'L1T1M02', title:'Number and Place Value 1', locked:false, state:'open', accessMode:'full' },
      { lessonId:'Y4M1', displayLessonId:'L1T3M23', title:'Estimate, Compare & Calculate Money', locked:false, state:'open', accessMode:'full' }
    ]
  }), {
    status:200,
    headers:{ 'content-type':'application/json' }
  });
}

const request = new Request('https://example.test/api/v1/student/views/maths-level1/lessons', {
  method:'GET',
  headers:{ Cookie:'fpt_session=test' }
});

// The outermost repair must discard obsolete bundled catalogue membership,
// restore current live display IDs/titles, include newly-live lessons and keep
// legitimate 11+ FULL entitlements open.
{
  const response = await repairLiveStudentCatalogueResponse(
    request,
    makeEnv(),
    {},
    staleResponse(),
    baseFetch
  );
  const body = await response.json();
  assert.deepEqual(body.lessons.map(row => row.lessonId), ['Y4M2','Y4M22','Y4M1']);
  assert.equal(body.lessons.some(row => row.lessonId === 'Y4M36'), false);
  assert.deepEqual(body.lessons.map(row => row.displayLessonId), ['L1T1M01','L1T2M19','L1T3M22']);
  assert.deepEqual(body.lessons.map(row => row.title), [
    'Number and Place Value 1', 'Fractions 5', 'Estimate, Compare & Calculate Money'
  ]);
  assert.ok(body.lessons.every(row => row.locked === false && row.accessMode === 'full'));
  assert.equal(body.view.visibleLessonCount, 3);
  assert.equal(body.view.openLessonCount, 3);
  assert.equal(body.view.lockedLessonCount, 0);
  assert.equal(response.headers.get('x-fpt-catalogue-authority'), 'live-kv-v1');
}

// Normal Year 4 Maths access must not leak into the 11+ L1 view.
{
  const response = await repairLiveStudentCatalogueResponse(
    request,
    makeEnv({ fullBatch:'Y4FM' }),
    {},
    staleResponse(),
    baseFetch
  );
  const body = await response.json();
  assert.ok(body.lessons.every(row => row.locked === true));
  assert.equal(body.view.openLessonCount, 0);
  assert.equal(body.view.lockedLessonCount, 3);
}

// Explicit full-library entitlement remains a valid route to full access even
// without per-lesson D1 rows.
{
  const response = await repairLiveStudentCatalogueResponse(
    request,
    makeEnv({ fullBatch:null, fullLibraries:['MATHS_L1_FULL'] }),
    {},
    staleResponse(),
    baseFetch
  );
  const body = await response.json();
  assert.ok(body.lessons.every(row => row.locked === false && row.accessMode === 'full'));
}

console.log('Live student catalogue overlay verification: PASS');
