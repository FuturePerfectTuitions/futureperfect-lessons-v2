import phase10Worker from './index-phase10.js';

function batchCodes(user) {
  return Array.isArray(user?.batches)
    ? user.batches.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
    : [];
}

function mathsViewForBatch(code) {
  const match = String(code || '').match(/^Y([2-6])M(11)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const elevenPlus = Boolean(match[2]);
  if (elevenPlus && year === 4) return 'maths-level2';
  if (elevenPlus && year === 5) return 'maths-level3';
  return `maths-year${year}`;
}

function englishViewForBatch(code) {
  const match = String(code || '').match(/^Y([2-6])E(11)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const elevenPlus = Boolean(match[2]) && (year === 4 || year === 5);
  return `english-year${year}${elevenPlus ? '-11plus' : ''}`;
}

function crossSubjectCurrentViewIds(user) {
  const codes = batchCodes(user);
  const mathsCodes = codes.filter(code => /^Y[2-6]M/.test(code));
  const englishCodes = codes.filter(code => /^Y[2-6]E/.test(code));
  const current = new Set();

  for (const code of mathsCodes) {
    const viewId = mathsViewForBatch(code);
    if (viewId) current.add(viewId);
  }
  for (const code of englishCodes) {
    const viewId = englishViewForBatch(code);
    if (viewId) current.add(viewId);
  }

  const schoolYear = Number(user?.schoolYear || 0);
  if (schoolYear >= 2 && schoolYear <= 6) {
    if (mathsCodes.length && !englishCodes.length) {
      const maths11 = mathsCodes.some(code => /^Y[45]M11/.test(code));
      current.add(`english-year${schoolYear}${maths11 && (schoolYear === 4 || schoolYear === 5) ? '-11plus' : ''}`);
    }
    if (englishCodes.length && !mathsCodes.length) {
      current.add(`maths-year${schoolYear}`);
    }
  }

  return current;
}

async function groupedHomeResponse(request, env) {
  const response = await phase10Worker.fetch(request, env);
  if (!response?.ok) return response;

  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !body?.student?.portalUserId || !Array.isArray(body.subjects)) return response;

  const portalUserIdNorm = String(body.student.portalUserId || '').trim().toLowerCase();
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return response;

  const currentViewIds = crossSubjectCurrentViewIds(user);
  for (const subject of body.subjects) {
    for (const view of Array.isArray(subject?.views) ? subject.views : []) {
      const current = currentViewIds.has(String(view?.viewId || ''));
      view.current = current;
      view.group = current ? 'current' : 'previous';
    }
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return groupedHomeResponse(request, env);
    }
    return phase10Worker.fetch(request, env);
  }
};
