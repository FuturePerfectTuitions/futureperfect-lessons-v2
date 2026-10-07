import assert from 'node:assert/strict';
import { compileCatalogueReadModel } from '../rebuild/shared/read-models/catalogue.mjs';

const input = {
  curricula: {
    MATHS_L3: {
      lessonIds: ['L3M24','Y6ONLY25','L3M25','L3M42','Y6ONLY43','L3M43']
    },
    MATHS_Y6_EXTRA: []
  },
  lessons: {
    L3M24: { lessonId:'L3M24', active:true, order:24, title:'Linear Sequences', displayIds:{'maths-level3':'L3T2M24'} },
    Y6ONLY25: { lessonId:'Y6ONLY25', active:true, order:25, title:'Year 6 only 25', displayIds:{'maths-year6':'Y6T2M9'} },
    L3M25: { lessonId:'L3M25', active:true, order:25, title:'Mean Median Mode', displayIds:{'maths-level3':'L3T2M25'} },
    L3M42: { lessonId:'L3M42', active:true, order:42, title:'Properties of Shapes 6', displayIds:{'maths-level3':'L3T3M42','maths-year6':'Y6T3M12'} },
    Y6ONLY43: { lessonId:'Y6ONLY43', active:true, order:43, title:'Non Standard Partitioning', displayIds:{'maths-year6':'Y6T3M13'} },
    L3M43: { lessonId:'L3M43', active:true, order:43, title:'Advanced Statistics', displayIds:{'maths-level3':'L3T3M43'} }
  }
};

const model = compileCatalogueReadModel(input, { sourceType:'test', sourceRevision:'test' });
const l3 = model.views['maths-level3'].lessons;
const y6 = model.views['maths-year6'].lessons;

assert.deepEqual(
  l3.map(row => row.displayLessonId),
  ['L3T2M24','L3T2M25','L3T3M42','L3T3M43']
);
assert.equal(l3.some(row => row.lessonId === 'Y6ONLY25' || row.lessonId === 'Y6ONLY43'), false);
assert.equal(y6.some(row => row.lessonId === 'L3M25' || row.lessonId === 'L3M43'), false);
assert.equal(model.lessonToViews.L3M25.includes('maths-level3'), true);
assert.equal(model.lessonToViews.L3M25.includes('maths-year6'), false);
assert.equal(model.lessonToViews.Y6ONLY25.includes('maths-year6'), true);
assert.equal(model.lessonToViews.Y6ONLY25.includes('maths-level3'), false);

console.log('L3_PREPARED_VIEW_ALIAS_FILTER_PASS');

const bad = structuredClone(input);
bad.lessons.L3M25.order = null;
assert.throws(
  () => compileCatalogueReadModel(bad, { sourceType:'test', sourceRevision:'bad-order' }),
  /MATHS_LEVEL3_ORDER_REQUIRED:L3M25:L3T2M25/
);
console.log('L3_PREPARED_ORDER_FAIL_CLOSED_PASS');
