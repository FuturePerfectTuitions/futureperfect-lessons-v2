const clean = value => String(value ?? '').trim();

function keyOf(value) {
  if (!value || typeof value !== 'object') return '';
  return clean(value.r2Key || value.r2 || value.objectKey || value.storageKey || value.key);
}

function scopeList(value) {
  const raw = Array.isArray(value?.presentationScopes) ? value.presentationScopes : [];
  const scopes = [...new Set(raw.map(clean).filter(Boolean))];
  return scopes.length ? scopes.sort() : ['core'];
}

function mergeScopes(left, right) {
  const merged = new Set([...scopeList(left), ...scopeList(right)]);
  return merged.has('core') ? ['core'] : [...merged].sort();
}

function add(rows, value, { type, scope = 'core', protectedResource = false }) {
  const objectKey = keyOf(value);
  if (!objectKey) return;
  const displayName = clean(value?.displayName || value?.name || value?.title || type) || type;
  const candidate = {
    type,
    displayName,
    objectKey,
    ...(protectedResource ? { protected: true } : {}),
    ...(scope === 'core' ? {} : { presentationScopes: [scope] })
  };
  const existing = rows.get(objectKey);
  if (!existing) {
    rows.set(objectKey, candidate);
    return;
  }
  const scopes = mergeScopes(existing, candidate);
  const protectedAny = existing.protected === true || protectedResource;
  rows.set(objectKey, {
    ...existing,
    type: protectedAny && (existing.type === 'answer-pack' || type === 'answer-pack') ? 'answer-pack' : existing.type,
    ...(protectedAny ? { protected: true } : {}),
    ...(scopes.length === 1 && scopes[0] === 'core' ? {} : { presentationScopes: scopes })
  });
  if (scopes.length === 1 && scopes[0] === 'core') delete rows.get(objectKey).presentationScopes;
}

function addPair(rows, value, { primaryKeys, primaryType, scope }) {
  if (!value || typeof value !== 'object') return;
  const primary = primaryKeys.map(name => value?.[name]).find(item => item && typeof item === 'object') || null;
  add(rows, primary, { type: primaryType, scope });
  add(rows, value.answerPack || value.answerKey || value.answer, { type: 'answer-pack', scope, protectedResource: true });
}

function expectedLegacyResourceRows(record) {
  const rows = new Map();
  const core = record?.core && typeof record.core === 'object' ? record.core : {};
  const pre = Array.isArray(record?.preLessonSheets) ? record.preLessonSheets : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(record?.homeworks) ? record.homeworks : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const other = Array.isArray(record?.otherResources) ? record.otherResources : (Array.isArray(core.otherResources) ? core.otherResources : []);

  for (const item of pre) add(rows, item, { type: 'prelesson' });
  for (const pair of homeworks) {
    const primary = pair?.homework && typeof pair.homework === 'object' ? pair.homework : pair;
    add(rows, primary, { type: 'homework' });
    add(rows, pair?.answerPack, { type: 'answer-pack', protectedResource: true });
  }
  for (const item of other) add(rows, item, { type: 'other' });

  const phase11 = record?.phase11Resources && typeof record.phase11Resources === 'object' ? record.phase11Resources : {};
  const p11Core = phase11.core && typeof phase11.core === 'object' ? phase11.core : {};
  const elevenPlus = phase11.elevenPlus && typeof phase11.elevenPlus === 'object' ? phase11.elevenPlus : {};
  const vr = phase11.vr && typeof phase11.vr === 'object' ? phase11.vr : {};

  for (const pair of Array.isArray(p11Core.preLessonPairs) ? p11Core.preLessonPairs : []) {
    addPair(rows, pair, { primaryKeys: ['sheet', 'primary'], primaryType: 'prelesson', scope: 'core' });
  }
  for (const pair of Array.isArray(p11Core.cumulativeHomeworks) ? p11Core.cumulativeHomeworks : []) {
    addPair(rows, pair, { primaryKeys: ['homework', 'primary'], primaryType: 'cumulative-homework', scope: 'core' });
  }
  for (const answer of Array.isArray(p11Core.supplementaryAnswers) ? p11Core.supplementaryAnswers : []) {
    add(rows, answer, { type: 'answer-pack', scope: 'core', protectedResource: true });
  }

  for (const pair of Array.isArray(elevenPlus.preLessonPairs) ? elevenPlus.preLessonPairs : []) {
    addPair(rows, pair, { primaryKeys: ['sheet', 'primary'], primaryType: 'prelesson', scope: 'elevenPlus' });
  }
  for (const pair of Array.isArray(elevenPlus.homeworks) ? elevenPlus.homeworks : []) {
    addPair(rows, pair, { primaryKeys: ['homework', 'primary'], primaryType: 'homework', scope: 'elevenPlus' });
  }
  for (const pair of Array.isArray(elevenPlus.cumulativeHomeworks) ? elevenPlus.cumulativeHomeworks : []) {
    addPair(rows, pair, { primaryKeys: ['homework', 'primary'], primaryType: 'cumulative-homework', scope: 'elevenPlus' });
  }
  for (const answer of Array.isArray(elevenPlus.supplementaryAnswers) ? elevenPlus.supplementaryAnswers : []) {
    add(rows, answer, { type: 'answer-pack', scope: 'elevenPlus', protectedResource: true });
  }
  for (const answer of Array.isArray(vr.supplementaryAnswers) ? vr.supplementaryAnswers : []) {
    add(rows, answer, { type: 'answer-pack', scope: 'vr', protectedResource: true });
  }

  return [...rows.values()];
}

function signature(row) {
  return `${clean(row?.type)}|${row?.protected === true ? 1 : 0}|${scopeList(row).join(',')}|${clean(row?.objectKey)}`;
}

function expectedLegacyResourceSignatures(record) {
  return expectedLegacyResourceRows(record).map(signature).sort();
}

function auditLegacyLessonResourceParity(record, compiledResources = []) {
  const expected = expectedLegacyResourceSignatures(record);
  const actual = (Array.isArray(compiledResources) ? compiledResources : [])
    .filter(row => clean(row?.objectKey))
    .map(signature)
    .sort();
  return {
    pass: JSON.stringify(expected) === JSON.stringify(actual),
    expected,
    actual
  };
}

function legacyPhase11Inventory(record) {
  const source = record?.phase11Resources && typeof record.phase11Resources === 'object' ? record.phase11Resources : {};
  const core = source.core && typeof source.core === 'object' ? source.core : {};
  const elevenPlus = source.elevenPlus && typeof source.elevenPlus === 'object' ? source.elevenPlus : {};
  const vr = source.vr && typeof source.vr === 'object' ? source.vr : {};
  const countPairs = values => (Array.isArray(values) ? values : []).length;
  const countAnswers = values => (Array.isArray(values) ? values : []).filter(Boolean).length;
  const cumulativePairs = countPairs(core.cumulativeHomeworks) + countPairs(elevenPlus.cumulativeHomeworks);
  const extensionEntries =
    countPairs(core.preLessonPairs) + countPairs(core.cumulativeHomeworks) + countAnswers(core.supplementaryAnswers) +
    countPairs(elevenPlus.preLessonPairs) + countPairs(elevenPlus.homeworks) + countPairs(elevenPlus.cumulativeHomeworks) + countAnswers(elevenPlus.supplementaryAnswers) +
    countAnswers(vr.supplementaryAnswers);
  return { extensionEntries, cumulativePairs };
}

export {
  expectedLegacyResourceRows,
  expectedLegacyResourceSignatures,
  auditLegacyLessonResourceParity,
  legacyPhase11Inventory
};
