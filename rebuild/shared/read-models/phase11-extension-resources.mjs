const clean = value => String(value ?? '').trim();

function objectKey(value) {
  if (!value || typeof value !== 'object') return '';
  return clean(value.r2Key || value.r2 || value.objectKey || value.storageKey || value.key);
}

function file(value, fallbackName) {
  if (!value || typeof value !== 'object') return null;
  const key = objectKey(value);
  if (!key) return null;
  return {
    displayName: clean(value.displayName || value.name || value.title || fallbackName) || fallbackName,
    objectKey: key
  };
}

function pair(value, primaryKeys, primaryFallback, answerFallback) {
  if (!value || typeof value !== 'object') return { primary: null, answer: null };
  const primaryValue = primaryKeys.map(key => value?.[key]).find(candidate => candidate && typeof candidate === 'object') || null;
  return {
    primary: file(primaryValue, primaryFallback),
    answer: file(value.answerPack || value.answerKey || value.answer, answerFallback)
  };
}

function pushFile(rows, value, { type, fallbackName, scope, protectedResource = false }) {
  const resource = file(value, fallbackName);
  if (!resource) return;
  rows.push({
    type,
    ...resource,
    ...(protectedResource ? { protected: true } : {}),
    ...(scope === 'core' ? {} : { presentationScopes: [scope] })
  });
}

function pushPairs(rows, values, { primaryKeys, primaryType, primaryFallback, answerFallback, scope }) {
  if (!Array.isArray(values)) return;
  values.forEach(value => {
    const normalized = pair(value, primaryKeys, primaryFallback, answerFallback);
    pushFile(rows, normalized.primary, {
      type: primaryType,
      fallbackName: primaryFallback,
      scope
    });
    pushFile(rows, normalized.answer, {
      type: 'answer-pack',
      fallbackName: answerFallback,
      scope,
      protectedResource: true
    });
  });
}

function collectPhase11ExtensionResources(record) {
  const source = record?.phase11Resources;
  if (!source || typeof source !== 'object') return [];

  const core = source.core && typeof source.core === 'object' ? source.core : {};
  const elevenPlus = source.elevenPlus && typeof source.elevenPlus === 'object' ? source.elevenPlus : {};
  const vr = source.vr && typeof source.vr === 'object' ? source.vr : {};
  const rows = [];

  pushPairs(rows, core.preLessonPairs, {
    primaryKeys: ['sheet', 'primary'],
    primaryType: 'prelesson',
    primaryFallback: 'PreLesson Sheet',
    answerFallback: 'PreLesson Answer Pack',
    scope: 'core'
  });
  pushPairs(rows, core.cumulativeHomeworks, {
    primaryKeys: ['homework', 'primary'],
    primaryType: 'cumulative-homework',
    primaryFallback: 'Cumulative Homework',
    answerFallback: 'Cumulative Homework Answer Pack',
    scope: 'core'
  });
  for (const answer of Array.isArray(core.supplementaryAnswers) ? core.supplementaryAnswers : []) {
    pushFile(rows, answer, {
      type: 'answer-pack', fallbackName: 'Additional Answer Pack', scope: 'core', protectedResource: true
    });
  }

  pushPairs(rows, elevenPlus.preLessonPairs, {
    primaryKeys: ['sheet', 'primary'],
    primaryType: 'prelesson',
    primaryFallback: '11+ PreLesson Sheet',
    answerFallback: '11+ PreLesson Answer Pack',
    scope: 'elevenPlus'
  });
  pushPairs(rows, elevenPlus.homeworks, {
    primaryKeys: ['homework', 'primary'],
    primaryType: 'homework',
    primaryFallback: '11+ Homework',
    answerFallback: '11+ Homework Answer Pack',
    scope: 'elevenPlus'
  });
  pushPairs(rows, elevenPlus.cumulativeHomeworks, {
    primaryKeys: ['homework', 'primary'],
    primaryType: 'cumulative-homework',
    primaryFallback: 'Cumulative Homework',
    answerFallback: 'Cumulative Homework Answer Pack',
    scope: 'elevenPlus'
  });
  for (const answer of Array.isArray(elevenPlus.supplementaryAnswers) ? elevenPlus.supplementaryAnswers : []) {
    pushFile(rows, answer, {
      type: 'answer-pack', fallbackName: 'Additional 11+ Answer Pack', scope: 'elevenPlus', protectedResource: true
    });
  }

  for (const answer of Array.isArray(vr.supplementaryAnswers) ? vr.supplementaryAnswers : []) {
    pushFile(rows, answer, {
      type: 'answer-pack', fallbackName: 'Additional VR Answer Pack', scope: 'vr', protectedResource: true
    });
  }

  return rows;
}

export { collectPhase11ExtensionResources };
