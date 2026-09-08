import assert from 'node:assert/strict';
import { sendParentEmail } from '../worker/src/parent-email.js';

const item = {
  name:'Annisha',
  parent:'Sheetal',
  parentEmail:'sara_shinde@hotmail.co.uk',
  subjectFromCsv:'English',
  lessonLabel:'Y5T1E01 Descriptive Writing Settings and Atmosphere',
  lessonDateDisplay:'7th September 2026',
  lessonStatus:'Ready',
  batchKey:'Y511OE1',
  remarks:'VR Sheets to be printed',
  emailType:'UPCOMING'
};

const payloads = [];
const result = await sendParentEmail({
  PARENT_EMAIL_TEST_TO:'sejal.mail@gmail.com',
  EMAIL:{
    async send(payload) {
      payloads.push(payload);
      return { messageId:'test-mode-message' };
    }
  }
}, item);

assert.equal(result.ok, true);
assert.equal(result.status, 'SENT');
assert.equal(result.testMode, true);
assert.equal(result.deliveredTo, 'sejal.mail@gmail.com');
assert.equal(result.intendedTo, 'sara_shinde@hotmail.co.uk');
assert.equal(result.intendedCc, 'barkha@futureperfect.education');
assert.equal(payloads.length, 1);
assert.equal(payloads[0].to, 'sejal.mail@gmail.com');
assert.equal('cc' in payloads[0], false, 'Test mode must not send a copy to Barkha');
assert.equal(payloads[0].subject, 'Upcoming Lesson for Annisha and the worksheets to be printed before the next session on 7th September 2026.');

console.log('Parent email test routing sends only to Sejal personal Gmail and preserves intended recipients in result metadata: PASS');
