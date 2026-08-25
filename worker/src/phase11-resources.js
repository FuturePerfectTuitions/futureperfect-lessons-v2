const ANSWER_INDEX_SPAN = 999;

const ANSWER_BASE = Object.freeze({
  CORE_PRELESSON: 3000,
  ELEVENPLUS_PRELESSON: 4000,
  ELEVENPLUS_HOMEWORK: 5000,
  CORE_CUMULATIVE: 6000,
  ELEVENPLUS_CUMULATIVE: 7000,
  CORE_SUPPLEMENTARY: 8000,
  ELEVENPLUS_SUPPLEMENTARY: 9000,
  VR_SUPPLEMENTARY: 10000
});

function text(value) {
  return String(value || '').trim();
}

function normaliseFile(value, fallbackName) {
  if (!value || typeof value !== 'object') return null;
  const r2Key = text(value.r2Key || value.r2);
  if (!r2Key) return null;
  return {
    displayName: text(value.displayName || value.name) || fallbackName,
    r2Key
  };
}

function normalisePair(value, primaryKey, primaryFallback, answerFallback) {
  if (!value || typeof value !== 'object') return null;
  const primary = normaliseFile(
    value[primaryKey] || value.sheet || value.homework || value.primary,
    primaryFallback
  );
  const answerPack = normaliseFile(
    value.answerPack || value.answerKey || value.answer,
    answerFallback
  );
  if (!primary && !answerPack) return null;
  return { primary, answerPack };
}

function normalisePairs(values, primaryKey, primaryFallback, answerFallback) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => normalisePair(value, primaryKey, primaryFallback, answerFallback))
    .filter(Boolean);
}

function normaliseAnswers(values, fallbackName = 'Additional Answer Pack') {
  if (!Array.isArray(values)) return [];
  return values.map(value => normaliseFile(value, fallbackName)).filter(Boolean);
}

function coreHomeworks(record) {
  if (Array.isArray(record?.homeworks)) return record.homeworks;
  if (Array.isArray(record?.core?.homeworks)) return record.core.homeworks;
  return [];
}

function answerIdentity(value) {
  const name = text(value?.displayName || value?.name).toLowerCase().replace(/\.pdf$/i, '');
  if (!name) return '';
  return name
    .replace(/\b(?:l\d+t\d+m\d+|y\d+t\d+(?:m|e|ee)\d+|y\d+[me]\d+)\b/g, ' ')
    .replace(/\b(?:answer|pack|homework)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function answerPacksFromPairs(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .map(pair => pair?.answerPack || null)
    .filter(Boolean);
}

function ordinaryCoreAnswerPacks(record) {
  return coreHomeworks(record)
    .map(pair => normaliseFile(
      pair?.answerPack || pair?.answerKey || pair?.answer,
      'Answer Pack'
    ))
    .filter(Boolean);
}

function suppressDuplicateAnswers(answers, pairedAnswers) {
  const seen = new Set(
    (Array.isArray(pairedAnswers) ? pairedAnswers : [])
      .map(answerIdentity)
      .filter(Boolean)
  );

  // Preserve array positions with null tombstones. Phase 11 answer resource keys
  // encode the original supplementary offset, so removing an item by splicing
  // would make an old key resolve to a different document. A null slot makes the
  // duplicate inaccessible while keeping every later protected resource stable.
  return (Array.isArray(answers) ? answers : []).map(answer => {
    if (!answer) return null;
    const identity = answerIdentity(answer);
    if (identity && seen.has(identity)) return null;
    if (identity) seen.add(identity);
    return answer;
  });
}

function normalisePhase11Resources(record) {
  const source = record?.phase11Resources;
  if (!source || typeof source !== 'object') {
    return {
      core: { preLessonPairs: [], cumulativeHomeworks: [], supplementaryAnswers: [] },
      elevenPlus: { preLessonPairs: [], homeworks: [], cumulativeHomeworks: [], supplementaryAnswers: [] },
      vr: { supplementaryAnswers: [] }
    };
  }

  const core = source.core && typeof source.core === 'object' ? source.core : {};
  const elevenPlus = source.elevenPlus && typeof source.elevenPlus === 'object'
    ? source.elevenPlus
    : {};
  const vr = source.vr && typeof source.vr === 'object' ? source.vr : {};

  const corePreLessonPairs = normalisePairs(
    core.preLessonPairs,
    'sheet',
    'PreLesson Sheet',
    'PreLesson Answer Pack'
  );
  const coreCumulativeHomeworks = normalisePairs(
    core.cumulativeHomeworks,
    'homework',
    'Cumulative Homework',
    'Cumulative Homework Answer Pack'
  );
  const coreSupplementaryAnswers = suppressDuplicateAnswers(
    normaliseAnswers(core.supplementaryAnswers),
    [
      ...ordinaryCoreAnswerPacks(record),
      ...answerPacksFromPairs(corePreLessonPairs),
      ...answerPacksFromPairs(coreCumulativeHomeworks)
    ]
  );

  const elevenPlusPreLessonPairs = normalisePairs(
    elevenPlus.preLessonPairs,
    'sheet',
    '11+ PreLesson Sheet',
    '11+ PreLesson Answer Pack'
  );
  const elevenPlusHomeworks = normalisePairs(
    elevenPlus.homeworks,
    'homework',
    '11+ Homework',
    '11+ Homework Answer Pack'
  );
  const elevenPlusCumulativeHomeworks = normalisePairs(
    elevenPlus.cumulativeHomeworks,
    'homework',
    'Cumulative Homework',
    'Cumulative Homework Answer Pack'
  );
  const elevenPlusSupplementaryAnswers = suppressDuplicateAnswers(
    normaliseAnswers(
      elevenPlus.supplementaryAnswers,
      'Additional 11+ Answer Pack'
    ),
    [
      ...answerPacksFromPairs(elevenPlusPreLessonPairs),
      ...answerPacksFromPairs(elevenPlusHomeworks),
      ...answerPacksFromPairs(elevenPlusCumulativeHomeworks)
    ]
  );

  return {
    core: {
      preLessonPairs: corePreLessonPairs,
      cumulativeHomeworks: coreCumulativeHomeworks,
      supplementaryAnswers: coreSupplementaryAnswers
    },
    elevenPlus: {
      preLessonPairs: elevenPlusPreLessonPairs,
      homeworks: elevenPlusHomeworks,
      cumulativeHomeworks: elevenPlusCumulativeHomeworks,
      supplementaryAnswers: elevenPlusSupplementaryAnswers
    },
    vr: {
      supplementaryAnswers: normaliseAnswers(
        vr.supplementaryAnswers,
        'Additional VR Answer Pack'
      )
    }
  };
}

function within(index, base) {
  return index > base && index <= base + ANSWER_INDEX_SPAN;
}

function classifyPhase11AnswerIndex(index) {
  if (within(index, ANSWER_BASE.CORE_PRELESSON)) return 'corePreLesson';
  if (within(index, ANSWER_BASE.ELEVENPLUS_PRELESSON)) return 'elevenPlusPreLesson';
  if (within(index, ANSWER_BASE.ELEVENPLUS_HOMEWORK)) return 'elevenPlusHomework';
  if (within(index, ANSWER_BASE.CORE_CUMULATIVE)) return 'coreCumulative';
  if (within(index, ANSWER_BASE.ELEVENPLUS_CUMULATIVE)) return 'elevenPlusCumulative';
  if (within(index, ANSWER_BASE.CORE_SUPPLEMENTARY)) return 'coreSupplementary';
  if (within(index, ANSWER_BASE.ELEVENPLUS_SUPPLEMENTARY)) return 'elevenPlusSupplementary';
  if (within(index, ANSWER_BASE.VR_SUPPLEMENTARY)) return 'vrSupplementary';
  return null;
}

function answerAt(record, category, index) {
  const model = normalisePhase11Resources(record);
  let base = 0;
  let resource = null;

  if (category === 'corePreLesson') {
    base = ANSWER_BASE.CORE_PRELESSON;
    resource = model.core.preLessonPairs[index - base - 1]?.answerPack || null;
  } else if (category === 'elevenPlusPreLesson') {
    base = ANSWER_BASE.ELEVENPLUS_PRELESSON;
    resource = model.elevenPlus.preLessonPairs[index - base - 1]?.answerPack || null;
  } else if (category === 'elevenPlusHomework') {
    base = ANSWER_BASE.ELEVENPLUS_HOMEWORK;
    resource = model.elevenPlus.homeworks[index - base - 1]?.answerPack || null;
  } else if (category === 'coreCumulative') {
    base = ANSWER_BASE.CORE_CUMULATIVE;
    resource = model.core.cumulativeHomeworks[index - base - 1]?.answerPack || null;
  } else if (category === 'elevenPlusCumulative') {
    base = ANSWER_BASE.ELEVENPLUS_CUMULATIVE;
    resource = model.elevenPlus.cumulativeHomeworks[index - base - 1]?.answerPack || null;
  } else if (category === 'coreSupplementary') {
    base = ANSWER_BASE.CORE_SUPPLEMENTARY;
    resource = model.core.supplementaryAnswers[index - base - 1] || null;
  } else if (category === 'elevenPlusSupplementary') {
    base = ANSWER_BASE.ELEVENPLUS_SUPPLEMENTARY;
    resource = model.elevenPlus.supplementaryAnswers[index - base - 1] || null;
  } else if (category === 'vrSupplementary') {
    base = ANSWER_BASE.VR_SUPPLEMENTARY;
    resource = model.vr.supplementaryAnswers[index - base - 1] || null;
  }

  return resource ? { ...resource, category } : null;
}

function phase11AnswerResource(record, index) {
  const category = classifyPhase11AnswerIndex(index);
  if (!category) return null;
  return answerAt(record, category, index);
}

function bridgePhase11Answers(record) {
  const model = normalisePhase11Resources(record);
  const existing = coreHomeworks(record);
  if (existing.length >= ANSWER_BASE.CORE_PRELESSON) {
    throw new Error('PHASE11_ANSWER_INDEX_COLLISION');
  }

  const homeworks = [...existing];
  const put = (base, values, selector) => {
    values.forEach((value, offset) => {
      const answerPack = selector(value);
      if (!answerPack?.r2Key) return;
      homeworks[base + offset] = {
        answerPack: {
          displayName: answerPack.displayName,
          r2Key: answerPack.r2Key
        }
      };
    });
  };

  put(ANSWER_BASE.CORE_PRELESSON, model.core.preLessonPairs, value => value?.answerPack);
  put(ANSWER_BASE.ELEVENPLUS_PRELESSON, model.elevenPlus.preLessonPairs, value => value?.answerPack);
  put(ANSWER_BASE.ELEVENPLUS_HOMEWORK, model.elevenPlus.homeworks, value => value?.answerPack);
  put(ANSWER_BASE.CORE_CUMULATIVE, model.core.cumulativeHomeworks, value => value?.answerPack);
  put(ANSWER_BASE.ELEVENPLUS_CUMULATIVE, model.elevenPlus.cumulativeHomeworks, value => value?.answerPack);
  put(ANSWER_BASE.CORE_SUPPLEMENTARY, model.core.supplementaryAnswers, value => value);
  put(ANSWER_BASE.ELEVENPLUS_SUPPLEMENTARY, model.elevenPlus.supplementaryAnswers, value => value);
  put(ANSWER_BASE.VR_SUPPLEMENTARY, model.vr.supplementaryAnswers, value => value);

  return { ...record, homeworks };
}

function primaryDownloadResource(record, kind, index) {
  const model = normalisePhase11Resources(record);
  let pair = null;

  if (kind === 'p11corepre') pair = model.core.preLessonPairs[index - 1];
  else if (kind === 'p11corecum') pair = model.core.cumulativeHomeworks[index - 1];
  else if (kind === 'p11elevenpre') pair = model.elevenPlus.preLessonPairs[index - 1];
  else if (kind === 'p11elevenhw') pair = model.elevenPlus.homeworks[index - 1];
  else if (kind === 'p11elevencum') pair = model.elevenPlus.cumulativeHomeworks[index - 1];

  return pair?.primary || null;
}

function answerIndexFor(category, offset) {
  const mapping = {
    corePreLesson: ANSWER_BASE.CORE_PRELESSON,
    elevenPlusPreLesson: ANSWER_BASE.ELEVENPLUS_PRELESSON,
    elevenPlusHomework: ANSWER_BASE.ELEVENPLUS_HOMEWORK,
    coreCumulative: ANSWER_BASE.CORE_CUMULATIVE,
    elevenPlusCumulative: ANSWER_BASE.ELEVENPLUS_CUMULATIVE,
    coreSupplementary: ANSWER_BASE.CORE_SUPPLEMENTARY,
    elevenPlusSupplementary: ANSWER_BASE.ELEVENPLUS_SUPPLEMENTARY,
    vrSupplementary: ANSWER_BASE.VR_SUPPLEMENTARY
  };
  const base = mapping[category];
  if (!base || !Number.isInteger(offset) || offset < 1 || offset > ANSWER_INDEX_SPAN) return null;
  return base + offset;
}

export {
  ANSWER_BASE,
  ANSWER_INDEX_SPAN,
  answerIdentity,
  suppressDuplicateAnswers,
  normalisePhase11Resources,
  classifyPhase11AnswerIndex,
  phase11AnswerResource,
  bridgePhase11Answers,
  primaryDownloadResource,
  answerIndexFor
};
