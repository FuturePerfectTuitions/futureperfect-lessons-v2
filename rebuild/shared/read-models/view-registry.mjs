const VIEW_DEFINITIONS = Object.freeze({
  'maths-year2': Object.freeze({
    viewId: 'maths-year2', subject: 'maths', label: 'Year 2', rank: 20,
    schoolYear: 2, stream: 'normal', curricula: Object.freeze(['MATHS_Y2']),
    fullLibraryIds: Object.freeze(['MATHS_Y2_FULL'])
  }),
  'maths-year3': Object.freeze({
    viewId: 'maths-year3', subject: 'maths', label: 'Year 3', rank: 30,
    schoolYear: 3, stream: 'normal', curricula: Object.freeze(['MATHS_Y3']),
    fullLibraryIds: Object.freeze(['MATHS_Y3_FULL'])
  }),
  'maths-year4': Object.freeze({
    viewId: 'maths-year4', subject: 'maths', label: 'Year 4', rank: 40,
    schoolYear: 4, stream: 'normal', curricula: Object.freeze(['MATHS_L1']),
    fullLibraryIds: Object.freeze(['MATHS_Y4_FULL'])
  }),
  'maths-level1': Object.freeze({
    viewId: 'maths-level1', subject: 'maths', label: 'L1', rank: 41,
    schoolYear: 4, stream: '11plus', mathsLevel: 1, curricula: Object.freeze(['MATHS_L1']),
    fullLibraryIds: Object.freeze(['MATHS_L1_FULL'])
  }),
  'maths-year5': Object.freeze({
    viewId: 'maths-year5', subject: 'maths', label: 'Year 5', rank: 50,
    schoolYear: 5, stream: 'normal', curricula: Object.freeze(['MATHS_L2']),
    fullLibraryIds: Object.freeze(['MATHS_Y5_FULL'])
  }),
  'maths-level2': Object.freeze({
    viewId: 'maths-level2', subject: 'maths', label: 'L2', rank: 51,
    schoolYear: 5, stream: '11plus', mathsLevel: 2, curricula: Object.freeze(['MATHS_L2']),
    fullLibraryIds: Object.freeze(['MATHS_L2_FULL'])
  }),
  'maths-year6': Object.freeze({
    viewId: 'maths-year6', subject: 'maths', label: 'Year 6', rank: 60,
    schoolYear: 6, stream: 'normal', curricula: Object.freeze(['MATHS_L3', 'MATHS_Y6_EXTRA']),
    fullLibraryIds: Object.freeze(['MATHS_Y6_FULL'])
  }),
  'maths-level3': Object.freeze({
    viewId: 'maths-level3', subject: 'maths', label: 'L3', rank: 61,
    schoolYear: 6, stream: '11plus', mathsLevel: 3, curricula: Object.freeze(['MATHS_L3']),
    fullLibraryIds: Object.freeze(['MATHS_L3_FULL'])
  }),
  'english-year2': Object.freeze({
    viewId: 'english-year2', subject: 'english', label: 'Year 2', rank: 20,
    schoolYear: 2, stream: 'normal', curricula: Object.freeze(['ENGLISH_Y2']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y2_FULL'])
  }),
  'english-year3': Object.freeze({
    viewId: 'english-year3', subject: 'english', label: 'Year 3', rank: 30,
    schoolYear: 3, stream: 'normal', curricula: Object.freeze(['ENGLISH_Y3']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y3_FULL'])
  }),
  'english-year4': Object.freeze({
    viewId: 'english-year4', subject: 'english', label: 'Year 4', rank: 40,
    schoolYear: 4, stream: 'normal', curricula: Object.freeze(['ENGLISH_Y4']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y4_FULL'])
  }),
  'english-year4-11plus': Object.freeze({
    viewId: 'english-year4-11plus', subject: 'english', label: 'Year 4 11+', rank: 41,
    schoolYear: 4, stream: '11plus', curricula: Object.freeze(['ENGLISH_Y4']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y4_11PLUS_FULL'])
  }),
  'english-year5': Object.freeze({
    viewId: 'english-year5', subject: 'english', label: 'Year 5', rank: 50,
    schoolYear: 5, stream: 'normal', curricula: Object.freeze(['ENGLISH_Y5']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y5_FULL'])
  }),
  'english-year5-11plus': Object.freeze({
    viewId: 'english-year5-11plus', subject: 'english', label: 'Year 5 11+', rank: 51,
    schoolYear: 5, stream: '11plus', curricula: Object.freeze(['ENGLISH_Y5']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y5_11PLUS_FULL'])
  }),
  'english-year6': Object.freeze({
    viewId: 'english-year6', subject: 'english', label: 'Year 6', rank: 60,
    schoolYear: 6, stream: 'normal', curricula: Object.freeze(['ENGLISH_Y6']),
    fullLibraryIds: Object.freeze(['ENGLISH_Y6_FULL'])
  })
});

const VIEW_IDS = Object.freeze(Object.keys(VIEW_DEFINITIONS));

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function viewDefinition(viewId) {
  return VIEW_DEFINITIONS[norm(viewId)] || null;
}

function viewIdForBatch(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);

  if (subject === 'maths') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return viewDefinition(`maths-level${resolved}`)?.viewId || '';
    }
    return viewDefinition(`maths-year${year}`)?.viewId || '';
  }

  if (subject === 'english') {
    if (stream === '11plus') {
      if (year !== 4 && year !== 5) return '';
      return viewDefinition(`english-year${year}-11plus`)?.viewId || '';
    }
    return viewDefinition(`english-year${year}`)?.viewId || '';
  }

  return '';
}

function counterpartViewId(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);

  if (subject === 'maths') {
    if (stream === '11plus' && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    return viewDefinition(`english-year${year}`)?.viewId || '';
  }

  if (subject === 'english') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return viewDefinition(`maths-level${resolved}`)?.viewId || '';
    }
    return viewDefinition(`maths-year${year}`)?.viewId || '';
  }

  return '';
}

function sortedViewIds(values = VIEW_IDS) {
  return [...new Set(values.map(norm).filter(id => VIEW_DEFINITIONS[id]))]
    .sort((left, right) => {
      const a = VIEW_DEFINITIONS[left];
      const b = VIEW_DEFINITIONS[right];
      return a.subject.localeCompare(b.subject) || a.rank - b.rank || left.localeCompare(right);
    });
}

function fullLibraryViewIds(values = []) {
  const libraries = new Set(values.map(value => clean(value).toUpperCase()).filter(Boolean));
  return sortedViewIds(VIEW_IDS.filter(viewId => {
    const aliases = VIEW_DEFINITIONS[viewId].fullLibraryIds || [];
    return aliases.some(value => libraries.has(String(value).toUpperCase()));
  }));
}

export {
  VIEW_DEFINITIONS,
  VIEW_IDS,
  clean,
  norm,
  viewDefinition,
  viewIdForBatch,
  counterpartViewId,
  sortedViewIds,
  fullLibraryViewIds
};
