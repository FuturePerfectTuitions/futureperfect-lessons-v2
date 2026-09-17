export const MODE_COUNTS = Object.freeze({ STRETCH: 15, TIMED: 30 });
export const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const ENGINE_VERSION = 'step9-v1.1-js-standalone-1';

const clean = value => String(value ?? '').trim();
const L3_RE = /^L3T\dM\d+$/i;
const L2_RE = /^L2T\dM\d+$/i;

export function prerequisiteCodes(value) {
  return clean(value).match(/L[23]T\dM\d+/gi)?.map(x => x.toUpperCase()) ?? [];
}

export function normaliseReleaseContext(input = {}) {
  const releasedL3 = new Set(
    Array.isArray(input.releasedL3LessonCodes)
      ? input.releasedL3LessonCodes.map(x => clean(x).toUpperCase()).filter(x => L3_RE.test(x))
      : []
  );
  return Object.freeze({
    l3Eligible: input.l3Eligible === true,
    l2Inherited: input.l2Inherited === true,
    releasedL3,
    source: clean(input.source || 'unknown')
  });
}

export function hardGate(candidate, releaseInput) {
  const release = normaliseReleaseContext(releaseInput);
  if (!release.l3Eligible) return { ok: false, reason: 'NOT_L3_ELIGIBLE' };
  if (!release.l2Inherited) return { ok: false, reason: 'L2_INHERITANCE_CONTEXT_MISSING' };
  if (Number(candidate.family_wide_eligible) !== 1) return { ok: false, reason: 'WITHHELD_FAMILY' };
  if (clean(candidate.family_status).toUpperCase() !== 'ELIGIBLE') return { ok: false, reason: 'WITHHELD_FAMILY' };
  if (clean(candidate.evidence_gate_status).toUpperCase() !== 'PASS') return { ok: false, reason: 'FAMILY_EVIDENCE_GATE' };
  if (clean(candidate.lifecycle_status).toUpperCase() !== 'LIVE') return { ok: false, reason: 'NOT_LIVE' };
  if (Number(candidate.question_evidence_count || 0) < 1) return { ok: false, reason: 'NO_QUESTION_EVIDENCE' };

  const earliest = clean(candidate.earliest_release_point).toUpperCase();
  if (earliest && earliest !== 'L3-START') {
    if (L2_RE.test(earliest)) {
      // Owner authority v1.6: all L2 is inherited from L3 day one.
    } else if (L3_RE.test(earliest)) {
      if (!release.releasedL3.has(earliest)) return { ok: false, reason: 'RELEASE_GATE' };
    } else {
      return { ok: false, reason: 'UNKNOWN_RELEASE_GATE' };
    }
  }

  for (const code of prerequisiteCodes(candidate.prerequisite_lessons)) {
    if (L2_RE.test(code)) continue;
    if (L3_RE.test(code) && !release.releasedL3.has(code)) {
      return { ok: false, reason: 'PREREQUISITE_GATE' };
    }
  }
  return { ok: true, reason: 'ELIGIBLE' };
}

function seedHash(input) {
  let h = 2166136261 >>> 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 0x9e3779b9;
}

function rngFactory(seed) {
  let x = seedHash(seed);
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

function shuffleStable(rows, rng) {
  const out = [...rows].sort((a, b) => clean(a.question_id).localeCompare(clean(b.question_id)));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function selectQuestions({
  mode,
  candidates,
  exposureHistory = [],
  releaseContext,
  weaknessByFamily = {},
  seed,
  now = new Date()
}) {
  const upperMode = clean(mode).toUpperCase();
  const need = MODE_COUNTS[upperMode];
  if (!need) throw new Error('BAD_MODE');
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('BAD_NOW');

  const lastSeen = new Map();
  const ever = new Set();
  for (const row of exposureHistory || []) {
    const qid = clean(row.question_id);
    if (!qid) continue;
    ever.add(qid);
    const ts = new Date(row.shown_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (!lastSeen.has(qid) || ts > lastSeen.get(qid)) lastSeen.set(qid, ts);
  }

  const blocked = [];
  const eligible = [];
  for (const q of candidates || []) {
    const gate = hardGate(q, releaseContext);
    if (!gate.ok) {
      blocked.push({ question_id: q.question_id, reason: gate.reason });
      continue;
    }
    const seenAt = lastSeen.get(clean(q.question_id));
    if (seenAt != null && nowMs - seenAt < COOLDOWN_MS) {
      blocked.push({ question_id: q.question_id, reason: 'COOLDOWN' });
      continue;
    }
    eligible.push(q);
  }

  const unseen = eligible.filter(q => !ever.has(clean(q.question_id)));
  const seen = eligible.filter(q => ever.has(clean(q.question_id)));
  const primary = unseen.length >= need ? unseen : [...unseen, ...seen];
  if (primary.length < need) {
    return {
      ok: false,
      error: 'DEPLETED_POOL',
      mode: upperMode,
      needed: need,
      available: primary.length,
      eligibleCount: eligible.length,
      unseenCount: unseen.length,
      blocked
    };
  }

  const rng = rngFactory(seed ?? `${upperMode}:${nowMs}`);
  const byFamily = new Map();
  for (const q of primary) {
    const family = clean(q.family_id);
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push(q);
  }
  for (const [family, rows] of byFamily) byFamily.set(family, shuffleStable(rows, rng));

  const ties = new Map([...byFamily.keys()].map(family => [family, rng()]));
  const families = [...byFamily.keys()].sort((a, b) => {
    const wa = Number(weaknessByFamily?.[a] || 0);
    const wb = Number(weaknessByFamily?.[b] || 0);
    if (wa !== wb) return wb - wa;
    const t = (ties.get(a) || 0) - (ties.get(b) || 0);
    return t || a.localeCompare(b);
  });

  const index = new Map(families.map(f => [f, 0]));
  const chosen = [];
  while (chosen.length < need) {
    let progressed = false;
    for (const family of families) {
      const rows = byFamily.get(family) || [];
      const i = index.get(family) || 0;
      if (i >= rows.length) continue;
      chosen.push(rows[i]);
      index.set(family, i + 1);
      progressed = true;
      if (chosen.length === need) break;
    }
    if (!progressed) break;
  }

  if (chosen.length < need) {
    return { ok: false, error: 'DEPLETED_POOL_AFTER_BREADTH', mode: upperMode, needed: need, available: chosen.length };
  }

  const trace = chosen.map((q, i) => ({
    position: i + 1,
    question_id: q.question_id,
    family_id: q.family_id,
    unseen: !ever.has(clean(q.question_id)),
    release_gate: q.earliest_release_point,
    reason: 'LIVE+QUESTION_EVIDENCE+FAMILY_ELIGIBLE+L2_INHERITED_OR_L3_RELEASED+PREREQS+COOLDOWN_CLEAR+UNSEEN_FIRST+BREADTH+ADAPTIVE_AFTER_HARD_GATES'
  }));

  return {
    ok: true,
    mode: upperMode,
    count: need,
    questionIds: chosen.map(q => q.question_id),
    chosen,
    trace,
    eligibleCount: eligible.length,
    unseenCount: unseen.length,
    blocked
  };
}
