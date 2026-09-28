import {
  compileAuthoritativeAccessScope as compileV2AccessScope,
  loadStudentAccessInput,
  assertReadModelReconciliationReady as assertV2ReadModelReady
} from './access-read-model-sync-v2.js';
import {
  SCOPE_SALT_KEY,
  assertCanonicalAccessProjected,
  publishScopeAtomic,
  resolveCurrentScope,
  opaqueAccessScopeId,
  globalToCatalogue
} from './access-read-model-sync.js';

const ACCESS_READ_MODEL_SYNC_V3_MARKER = 'd1-authoritative-11plus-history-presentation-v3';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
}

function asDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function currentAssignment(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  const to = asDate(row?.effective_to ?? row?.effectiveTo);
  const batchFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom ?? row?.active_from ?? row?.activeFrom);
  const batchTo = asDate(row?.batch_active_to ?? row?.batchActiveTo ?? row?.active_to ?? row?.activeTo);
  return (!from || from <= asOfDate) && (!to || asOfDate < to) &&
    (!batchFrom || batchFrom <= asOfDate) && (!batchTo || asOfDate < batchTo);
}

function mathsViewId(row) {
  if (norm(row?.subject) !== 'maths') return '';
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);
  if (stream === '11plus') {
    const resolved = level >= 1 && level <= 3 ? level : year - 3;
    return resolved >= 1 && resolved <= 3 ? `maths-level${resolved}` : '';
  }
  return year >= 2 && year <= 6 ? `maths-year${year}` : '';
}

function currentD1MathsViews(input, asOfDate) {
  return [...new Set((Array.isArray(input?.batchAssignments) ? input.batchAssignments : [])
    .filter(row => currentAssignment(row, asOfDate))
    .map(mathsViewId)
    .filter(Boolean))];
}

function currentD1ElevenPlusMathsViews(input, asOfDate) {
  return currentD1MathsViews(input, asOfDate).filter(id => /^maths-level[1-3]$/.test(id));
}

function demoteNormalMathsHistoryForElevenPlus(snapshot, originalInput, asOfDate) {
  if (!snapshot || !Array.isArray(snapshot.views)) return snapshot;
  const elevenPlus = currentD1ElevenPlusMathsViews(originalInput, asOfDate);
  if (elevenPlus.length !== 1) return snapshot;

  const actualCurrent = new Set(currentD1MathsViews(originalInput, asOfDate));
  for (const view of snapshot.views) {
    const id = norm(view?.viewId);
    if (!/^maths-year[2-6]$/.test(id) || view?.lockedPreview) continue;
    if (actualCurrent.has(id)) continue;
    view.current = false;
    view.group = 'previous';
  }
  return snapshot;
}

function compileAuthoritativeAccessScope(input, catalogue, scopeId, asOfDate) {
  const payload = compileV2AccessScope(input, catalogue, scopeId, asOfDate);
  demoteNormalMathsHistoryForElevenPlus(payload?.snapshot, input, asOfDate);
  return payload;
}

function kvBindingStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('READ_MODELS_KV binding with get/put is required.');
  }
  return {
    async get(key) { return binding.get(key); },
    async put(key, value) { return binding.put(key, value); }
  };
}

async function assertReadModelReconciliationReady(env) {
  const ready = await assertV2ReadModelReady(env);
  return { ...ready, marker:ACCESS_READ_MODEL_SYNC_V3_MARKER };
}

async function refreshStudentAccessReadModel(env, portalUserIdNorm, options = {}) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) {
    throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  }
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');

  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  if (!catalogue?.views?.['maths-sats'] || catalogue.views['maths-year6']?.label !== 'Lessons') {
    throw new Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');
  }

  const asOfDate = clean(options.asOfDate) || londonToday();
  const input = await loadStudentAccessInput(env, portalUserIdNorm, asOfDate);
  const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSalt);
  const payload = compileAuthoritativeAccessScope(input, catalogue, scopeId, asOfDate);
  assertCanonicalAccessProjected(input, payload);

  const published = await publishScopeAtomic(store, {
    scope:`access:${scopeId}`,
    payload,
    updatedAt:new Date().toISOString()
  });
  return {
    ok:true,
    portalUserIdNorm:norm(portalUserIdNorm),
    scopeId,
    version:published.version,
    sha256:published.payloadSha256,
    reused:published.reused === true,
    marker:ACCESS_READ_MODEL_SYNC_V3_MARKER
  };
}

export {
  ACCESS_READ_MODEL_SYNC_V3_MARKER,
  currentD1MathsViews,
  currentD1ElevenPlusMathsViews,
  demoteNormalMathsHistoryForElevenPlus,
  compileAuthoritativeAccessScope,
  loadStudentAccessInput,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
};
