import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/phase10-counts.js', import.meta.url), 'utf8');
const base = 'https://worker.example';
const allViews = [
  'maths-year2',
  'maths-year3',
  'maths-year4',
  'maths-year5',
  'maths-year6',
  'maths-level1',
  'maths-level2',
  'maths-level3',
  'english-year2',
  'english-year3',
  'english-year4',
  'english-year4-11plus',
  'english-year5',
  'english-year5-11plus',
  'english-year6'
];
const specialViews = new Set([
  'maths-level2',
  'maths-level3',
  'english-year4-11plus',
  'english-year5-11plus'
]);

function installPhase10Counts(upstreamFetch) {
  const window = {
    FPT_V2_CONFIG: { workerBaseUrl: base },
    location: { href: 'https://portal.example/' },
    fetch: upstreamFetch
  };
  const context = vm.createContext({
    window,
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    console
  });
  vm.runInContext(source, context, { filename: 'assets/phase10-counts.js' });
  return window.fetch;
}

function homeResponse() {
  return new Response(JSON.stringify({
    ok: true,
    subjects: [{
      name: 'Maths',
      views: allViews.map(viewId => ({
        viewId,
        openLessonCount: 3,
        lockedPreview: false
      }))
    }]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

async function testAbortSignalBoundsFanout() {
  const specialCalls = [];
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://portal.example/');
    if (url.pathname === '/api/v1/student/home') return homeResponse();
    if (url.pathname !== '/api/v1/student/special-areas') throw new Error(`Unexpected fetch ${url}`);

    const viewId = url.searchParams.get('viewId');
    specialCalls.push({ viewId, signal: init.signal });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true, areas: [{}, {}] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })), 300);
      if (init.signal) {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  };

  const fetch = installPhase10Counts(upstreamFetch);
  const controller = new AbortController();
  const started = Date.now();
  const pending = fetch(`${base}/api/v1/student/home`, { method: 'GET', signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  const response = await pending;
  const elapsed = Date.now() - started;
  const body = await response.json();

  assert(elapsed < 200, `Home augmentation outlived abort budget: ${elapsed}ms`);
  assert.equal(specialCalls.length, 4, `expected only four special-capable view requests, got ${specialCalls.length}`);
  assert.deepEqual(new Set(specialCalls.map(call => call.viewId)), specialViews);
  assert(specialCalls.every(call => call.signal === controller.signal), 'child requests did not receive Home AbortSignal');

  for (const view of body.subjects[0].views) {
    assert.equal(view.ordinaryOpenLessonCount, 3);
    assert.equal(view.specialLessonCount, 0);
    assert.equal(view.openLessonCount, 3);
  }
}

async function testSuccessfulCountsRemainAccurate() {
  const specialCalls = [];
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://portal.example/');
    if (url.pathname === '/api/v1/student/home') return homeResponse();
    if (url.pathname !== '/api/v1/student/special-areas') throw new Error(`Unexpected fetch ${url}`);

    const viewId = url.searchParams.get('viewId');
    specialCalls.push({ viewId, signal: init.signal });
    return new Response(JSON.stringify({ ok: true, areas: [{}, {}] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const fetch = installPhase10Counts(upstreamFetch);
  const response = await fetch(`${base}/api/v1/student/home`, { method: 'GET' });
  const body = await response.json();

  assert.equal(specialCalls.length, 4);
  assert.deepEqual(new Set(specialCalls.map(call => call.viewId)), specialViews);
  for (const view of body.subjects[0].views) {
    assert.equal(view.ordinaryOpenLessonCount, 3);
    if (specialViews.has(view.viewId)) {
      assert.equal(view.specialLessonCount, 2);
      assert.equal(view.openLessonCount, 5);
    } else {
      assert.equal(view.specialLessonCount, 0);
      assert.equal(view.openLessonCount, 3);
    }
  }
}

await testAbortSignalBoundsFanout();
await testSuccessfulCountsRemainAccurate();
console.log('PASS checkpoint0-home-bootstrap-regression');
