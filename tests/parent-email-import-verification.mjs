import assert from 'node:assert/strict';
import {
  emailTypeForItem,
  prelessonSheetsFromRemarks,
  buildParentEmail,
  sendParentEmail,
  slideText,
  SIGNATURE_CID,
  SIGNATURE_SOURCE_URL
} from '../worker/src/parent-email.js';
import {
  normalYearFromCsv,
  normaliseLessonLabelForYear,
  normaliseCsvInputRow,
  emailItemFromRow,
  decoratePreview
} from '../worker/src/admin-lesson-release-import-email.js';

// Production fetches this clean PNG server-side and passes the exact binary
// bytes to Cloudflare Email Sending as an ArrayBufferView CID attachment. Unit
// tests inject deterministic base64 which is decoded to the same binary shape.
assert.equal(
  SIGNATURE_SOURCE_URL,
  'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/assets/sej-email-signature-clean.png?v=20260908-inline'
);

// Normal Year 4/5/6 rows may arrive with L1/L2/L3 prefixes. The Year column,
// not the supplied L-number, is authoritative for normal students.
assert.equal(normalYearFromCsv('Year 4'), 4);
assert.equal(normalYearFromCsv('Year 5'), 5);
assert.equal(normalYearFromCsv('Year 6'), 6);
assert.equal(normalYearFromCsv('Year 4 11+ S'), null);
assert.equal(normaliseLessonLabelForYear('Year 4', 'L3T1M01 Number and Place Value I'), 'Y4T1M01 Number and Place Value I');
assert.equal(normaliseLessonLabelForYear('Year 5', 'L1T2M07 Fractions'), 'Y5T2M07 Fractions');
assert.equal(normaliseLessonLabelForYear('Year 6', 'L2T3M09 Ratio'), 'Y6T3M09 Ratio');
assert.equal(normaliseLessonLabelForYear('Year 4 11+ S', 'L1T1M01 Number and Place Value I'), 'L1T1M01 Number and Place Value I');
assert.equal(normaliseLessonLabelForYear('Year 5 11+', 'L2T1M01 Number and Place Value I'), 'L2T1M01 Number and Place Value I');

const normalized = normaliseCsvInputRow({
  Year:'Year 5',
  Lesson:'L3T1M01 Number and Place Value I'
});
assert.equal(normalized.Lesson, 'Y5T1M01 Number and Place Value I');

const upcomingRow = {
  Name:'Annisha',
  Year:'Year 5',
  Subject:'English',
  Lesson:'L2T1E01 Descriptive Writing Settings and Atmosphere',
  LessonDated:'7th September 2026',
  LessonStatus:'Ready',
  Remarks:'VR Sheets to be printed',
  Mode:'Y511OE1',
  Parent:'Sheetal',
  Email:'sara_shinde@hotmail.co.uk',
  Student:'Ann3009'
};
const completedRow = {
  Name:'Elaine',
  Year:'Year 6',
  Subject:'Maths',
  Lesson:'L3T1M33 Harry Potter Mystery',
  LessonDated:'15th July 2026',
  LessonStatus:'Completed',
  Remarks:'',
  Mode:'Y6FM',
  Parent:'Teena',
  Email:'Liteena@gmail.com',
  Student:'ElaineTest'
};
const ongoingRow = {
  Name:'Ava',
  Year:'Year 4',
  Subject:'Maths',
  Lesson:'L1T1M26 Time 2',
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

assert.equal(prelessonSheetsFromRemarks('VR Sheets to be printed'), true);
assert.equal(prelessonSheetsFromRemarks('PreLesson Sheets to be printed'), true);
assert.equal(prelessonSheetsFromRemarks('For this session, there are no PreLesson Sheets to be printed'), false);
assert.equal(prelessonSheetsFromRemarks(''), null);
assert.equal(slideText('Slide 25'), 'Slide 25');
assert.equal(slideText('continue from slide 12A'), 'Slide 12A');

const upcomingMail = buildParentEmail(upcoming);
assert.equal(
  upcomingMail.subject,
  'Upcoming Lesson for Annisha and the worksheets to be printed before the next session on 7th September 2026.'
);
assert.match(upcomingMail.html, /Hello Sheetal,/);
assert.match(upcomingMail.html, /<strong>&quot;Y5T1E01 Descriptive Writing Settings and Atmosphere&quot;<\/strong>/);
assert.match(upcomingMail.html, /For this session, there are PreLesson Sheets to be printed which have been shared on your portal\./);
assert.doesNotMatch(upcomingMail.html, /attached the VR PreLesson/i);
assert.equal(SIGNATURE_CID, 'fpt-email-signature-clean');
assert.match(upcomingMail.html, /src="cid:fpt-email-signature-clean"/);

const noSheetsMail = buildParentEmail({
  ...upcoming,
  remarks:'No PreLesson Sheets to be printed'
});
assert.match(noSheetsMail.html, /For this session, there are no PreLesson Sheets to be printed\./);

const completedMail = buildParentEmail(completed);
assert.equal(
  completedMail.subject,
  "Completed Lesson: Update on Elaine's Lesson and its homework, for the session on 15th July 2026."
);
assert.match(completedMail.html, /Elaine's class has studied/);
assert.match(completedMail.html, /The homework has already been uploaded so Elaine should be able to complete it this week\./);

const ongoingMail = buildParentEmail(ongoing);
assert.equal(
  ongoingMail.subject,
  "Ongoing Lesson: Update on Ava's Lesson and its homework, for the session on 8th July 2026."
);
assert.match(ongoingMail.html, /we will start from Slide 25 next session/);
assert.match(ongoingMail.html, /color:#ff0000/);
assert.match(ongoingMail.html, /Ava must have them handy for next lesson as well/);

// The preview exposes the intended parent email action but performs no send.
const preview = decoratePreview({
  ok:true,
  results:[{
    index:0,
    ok:true,
    action:'GRANT_PRELESSON',
    portalUserId:'Ann3009',
    lessonLabel:'Y5T1E01 Descriptive Writing Settings and Atmosphere'
  }],
  summary:{ total:1, releasable:1, skipped:0, errors:0 }
}, [normaliseCsvInputRow(upcomingRow)], null);
assert.equal(preview.results[0].emailAction, 'SEND_UPCOMING');
assert.equal(preview.results[0].parent, 'Sheetal');
assert.equal(preview.results[0].parentEmail, 'sara_shinde@hotmail.co.uk');
assert.equal(preview.summary.emailEligible, 1);

// Cloudflare Email Sending now receives an explicit raw RFC 5322 MIME message.
// The same MIME has To=parent and Cc=Barkha, while both addresses are supplied as
// envelope recipients. The signature part has a literal matching Content-ID.
const TEST_SIGNATURE_BASE64 = 'dGVzdC1zaWduYXR1cmU=';
const sentPayloads = [];
const env = {
  PARENT_EMAIL_SIGNATURE_BASE64: TEST_SIGNATURE_BASE64,
  __EMAIL_MESSAGE_FACTORY(from, to, raw) { return { from, to, raw }; },
  EMAIL:{
    async send(payload) {
      sentPayloads.push(payload);
      return { messageId:`synthetic-${sentPayloads.length}` };
    }
  }
};
const sent = await sendParentEmail(env, upcoming);
assert.equal(sent.ok, true);
assert.equal(sent.status, 'SENT');
assert.equal(sent.messageId, 'synthetic-1');
assert.equal(sentPayloads.length, 2);
assert.equal(sentPayloads[0].from, 'sej@futureperfect.education');
assert.equal(sentPayloads[0].to, 'sara_shinde@hotmail.co.uk');
assert.equal(sentPayloads[1].to, 'barkha@futureperfect.education');
assert.equal(sentPayloads[0].raw, sentPayloads[1].raw);
assert.match(sentPayloads[0].raw, /From: Sejal Dalal <sej@futureperfect\.education>/);
assert.match(sentPayloads[0].raw, /To: sara_shinde@hotmail\.co\.uk/);
assert.match(sentPayloads[0].raw, /Cc: Barkha <barkha@futureperfect\.education>/);
assert.match(sentPayloads[0].raw, /Content-Type: multipart\/related/);
assert.match(sentPayloads[0].raw, /Content-ID: <fpt-email-signature-clean>/);
assert.match(sentPayloads[0].raw, /X-Attachment-Id: fpt-email-signature-clean/);
assert.match(sentPayloads[0].raw, /Content-Disposition: inline; filename="fpt-email-signature\.png"/);
assert.match(sentPayloads[0].raw, /dGVzdC1zaWduYXR1cmU=/);

// A delivery failure is reported as an email failure; it does not throw and
// therefore cannot roll back a Portal entitlement already committed before send.
const failed = await sendParentEmail({
  PARENT_EMAIL_SIGNATURE_BASE64: TEST_SIGNATURE_BASE64,
  __EMAIL_MESSAGE_FACTORY(from, to, raw) { return { from, to, raw }; },
  EMAIL:{ async send() { throw Object.assign(new Error('Synthetic delivery failure'), { code:'DELIVERY_FAILURE' }); } }
}, completed);
assert.equal(failed.ok, false);
assert.equal(failed.status, 'DELIVERY_FAILURE');
assert.match(failed.message, /Synthetic delivery failure/);

console.log('Parent CSV email triggers, formatting, runtime signature loading, raw MIME CID linkage, L-prefix normalisation and Cloudflare delivery: PASS');
