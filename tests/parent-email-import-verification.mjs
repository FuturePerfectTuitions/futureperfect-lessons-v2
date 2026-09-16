import assert from 'node:assert/strict';
import {
  normaliseCsvInputRow,
  emailItemFromRow,
  decoratePreview,
  runImportWithParentEmails
} from '../worker/src/admin-lesson-release-import-email.js';
import {
  emailTypeForItem,
  partialProgressFromRemarks,
  continuingLessonFromRemarks,
  prelessonSheetsFromRemarks,
  buildParentEmail
} from '../worker/src/parent-email.js';

const upcomingRow = {
  Name:'Annisha',
  Year:'Year 5',
  Subject:'English',
  Lesson:'Y5T1E01 Descriptive Writing Settings and Atmosphere',
  LessonDated:'7th September 2026',
  LessonStatus:'Ready',
  Remarks:'PreLesson Sheets to be printed',
  Mode:'Y511OE1',
  Parent:'Kalpesh',
  Email:'kalpesh@example.com',
  Student:'Ann3009'
};

const completedRow = {
  Name:'Aarav',
  Year:'Year 6',
  Subject:'Maths',
  Lesson:'Y6T1M33 Harry Potter Mystery',
  LessonDated:'8th July 2026',
  LessonStatus:'Completed',
  Remarks:'',
  Mode:'Y6FM',
  Parent:'Shweta',
  Email:'shweta@example.com',
  Student:'Aar1811'
};

const ongoingRow = {
  Name:'Ava',
  Year:'Year 4',
  Subject:'Maths',
  Lesson:'Y4T1M26 Time 2',
  LessonDated:'8th July 2026',
  LessonStatus:'Slide 25',
  Remarks:'',
  Mode:'Y4FM',
  Parent:'Claire',
  Email:'claire@example.com',
  Student:'Ava2007'
};

const upcoming = emailItemFromRow(upcomingRow, 0);
const completed = emailItemFromRow(completedRow, 1);
const ongoing = emailItemFromRow(ongoingRow, 2);

assert.equal(upcoming.lessonLabel, 'Y5T1E01 Descriptive Writing Settings and Atmosphere');
assert.equal(completed.lessonLabel, 'Y6T1M33 Harry Potter Mystery');
assert.equal(ongoing.lessonLabel, 'Y4T1M26 Time 2');
assert.equal(upcoming.emailType, 'UPCOMING');
assert.equal(completed.emailType, 'COMPLETED');
assert.equal(ongoing.emailType, 'ONGOING');
assert.equal(emailTypeForItem({ lessonStatus:'Ready', batchKey:'Y5FE' }), '');
assert.equal(emailTypeForItem({ lessonStatus:'Not Completed', batchKey:'Y5FM' }), '');
assert.equal(emailTypeForItem({ lessonStatus:'Slide 9', batchKey:'Y5FM' }), 'ONGOING');
assert.equal(emailTypeForItem({ lessonStatus:'something COMPLETED today', batchKey:'Y5FM' }), 'COMPLETED');
assert.equal(partialProgressFromRemarks('Completed till slide 10'), true);
assert.equal(partialProgressFromRemarks('Completed up to slide 18'), true);
assert.equal(partialProgressFromRemarks('Completed the lesson'), false);
// Remarks preserve useful progress history, but once the row's final status is
// Completed they must not reclassify that lesson's parent email as Ongoing.
assert.equal(emailTypeForItem({ lessonStatus:'Completed', remarks:'Completed till slide 10', batchKey:'Y6FM' }), 'COMPLETED');
assert.equal(emailTypeForItem({ lessonStatus:'Completed', remarks:'Homework uploaded', batchKey:'Y6FM' }), 'COMPLETED');

// A Ready online row with "Start from ..." is a continuation of the previous
// session. It must not require a new PreLesson-Sheets remark or trigger another
// upcoming parent email; the Portal release itself must remain valid.
assert.equal(continuingLessonFromRemarks('Start from 10'), true);
assert.equal(continuingLessonFromRemarks('Start from slide 16'), true);
assert.equal(continuingLessonFromRemarks('Continue from page 4'), true);
assert.equal(continuingLessonFromRemarks('PreLesson Sheets to be printed'), false);
const continuingRow = {
  ...upcomingRow,
  LessonDated:'14th September 2026',
  Remarks:'Start from 10'
};
const continuing = emailItemFromRow(continuingRow, 3);
assert.equal(continuing.emailType, '');
const continuingPreview = decoratePreview({
  ok:true,
  results:[{
    index:0,
    ok:true,
    action:'ALREADY_PRELESSON',
    portalUserId:'Ann3009',
    lessonLabel:'Y5T1E01 Descriptive Writing Settings and Atmosphere'
  }]
}, [continuingRow]);
assert.equal(continuingPreview.results[0].emailAction, 'NO_EMAIL');
assert.equal(continuingPreview.results[0].emailEligible, false);

assert.equal(prelessonSheetsFromRemarks('PreLesson Sheets to be printed'), true);
assert.equal(prelessonSheetsFromRemarks('No PreLesson Sheets'), false);
assert.equal(prelessonSheetsFromRemarks('VR Sheets to be printed'), true);
assert.equal(prelessonSheetsFromRemarks(''), null);

const upcomingBuilt = buildParentEmail(upcoming);
const completedBuilt = buildParentEmail(completed);
const ongoingBuilt = buildParentEmail(ongoing);
assert.equal(upcomingBuilt.emailType, 'UPCOMING');
assert.equal(completedBuilt.emailType, 'COMPLETED');
assert.equal(ongoingBuilt.emailType, 'ONGOING');
assert.match(upcomingBuilt.subject, /English Lesson/i);
assert.match(completedBuilt.subject, /Maths Lesson/i);
assert.match(ongoingBuilt.subject, /Maths Lesson/i);

const preview = decoratePreview({
  ok:true,
  results:[
    { index:0, ok:true, action:'GRANT_PRELESSON', portalUserId:'Ann3009', lessonLabel:upcomingRow.Lesson },
    { index:1, ok:true, action:'GRANT_FULL', portalUserId:'Aar1811', lessonLabel:completedRow.Lesson },
    { index:2, ok:true, action:'GRANT_FULL', portalUserId:'Ava2007', lessonLabel:ongoingRow.Lesson }
  ]
}, [upcomingRow, completedRow, ongoingRow]);
assert.equal(preview.results[0].emailAction, 'SEND_UPCOMING');
assert.equal(preview.results[1].emailAction, 'SEND_COMPLETED');
assert.equal(preview.results[2].emailAction, 'SEND_ONGOING');
assert.equal(preview.summary.emailEligible, 3);

const fetchCalls = [];
const fetchImpl = async (url, options = {}) => {
  fetchCalls.push({ url:String(url), options });
  if (String(url).endsWith('/api/v1/admin/lesson-releases/preview')) {
    return new Response(JSON.stringify({
      ok:true,
      results:[
        { index:0, ok:true, action:'GRANT_PRELESSON', portalUserId:'Ann3009', lessonLabel:upcomingRow.Lesson },
        { index:1, ok:true, action:'GRANT_FULL', portalUserId:'Aar1811', lessonLabel:completedRow.Lesson },
        { index:2, ok:true, action:'GRANT_FULL', portalUserId:'Ava2007', lessonLabel:ongoingRow.Lesson }
      ],
      summary:{ total:3, releasable:3, skipped:0, errors:0 }
    }), { status:200, headers:{ 'content-type':'application/json' } });
  }
  if (String(url).endsWith('/api/v1/admin/lesson-releases/confirm')) {
    return new Response(JSON.stringify({
      ok:true,
      results:[
        { index:0, ok:true, status:'CREATED', portalUserId:'Ann3009', lessonLabel:upcomingRow.Lesson },
        { index:1, ok:true, status:'CREATED', portalUserId:'Aar1811', lessonLabel:completedRow.Lesson },
        { index:2, ok:true, status:'CREATED', portalUserId:'Ava2007', lessonLabel:ongoingRow.Lesson }
      ],
      summary:{ total:3, succeeded:3, failed:0 }
    }), { status:200, headers:{ 'content-type':'application/json' } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

const imported = await runImportWithParentEmails({
  fetchImpl,
  baseUrl:'https://example.test',
  token:'synthetic-token',
  rows:[upcomingRow, completedRow, ongoingRow]
});
assert.equal(imported.ok, true);
assert.equal(imported.summary.total, 3);
assert.equal(imported.summary.succeeded, 3);
assert.equal(imported.summary.failed, 0);
assert.equal(imported.summary.emailEligible, 3);
assert.equal(fetchCalls.length, 2);
assert.match(fetchCalls[0].url, /preview$/);
assert.match(fetchCalls[1].url, /confirm$/);

console.log('Parent email CSV import mapping, templates, and import integration: PASS');
