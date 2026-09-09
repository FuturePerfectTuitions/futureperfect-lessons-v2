import assert from 'node:assert/strict';
import { sendEmailsAfterConfirm } from '../worker/src/admin-lesson-release-import-email.js';

const row = {
  Name:'Annisha',
  Year:'Year 5',
  Subject:'English',
  Lesson:'L2T1E01 Descriptive Writing Settings and Atmosphere',
  LessonDated:'7th September 2026',
  LessonStatus:'Ready',
  Remarks:'PreLesson Sheets to be printed',
  Mode:'Y511OE1',
  Parent:'Sheetal',
  Email:'sheetal@example.com',
  Student:'Ann3009'
};

const store = new Map();
const sentPayloads = [];
const env = {
  PARENT_EMAIL_SIGNATURE_BASE64:'dGVzdC1zaWduYXR1cmU=',
  STUDENTS_KV:{
    async get(key, options) {
      const value = store.get(key);
      if (value == null) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    }
  },
  EMAIL:{
    async send(payload) {
      sentPayloads.push(payload);
      return { messageId:`message-${sentPayloads.length}` };
    }
  }
};

const portalBody = {
  ok:true,
  results:[{
    index:0,
    portalUserId:'Ann3009',
    inputLessonId:'Y5T1E01',
    lessonId:'Y5T1E01',
    ok:true,
    status:'CREATED'
  }],
  summary:{ total:1, succeeded:1, failed:0 }
};

const first = await sendEmailsAfterConfirm(env, [row], portalBody);
assert.equal(first.summary.emailsSent, 1);
assert.equal(first.summary.emailsAlreadySent, 0);
assert.equal(first.summary.emailsFailed, 0);
assert.equal(first.emailResults[0].status, 'SENT');
assert.equal(sentPayloads.length, 1);
assert.equal(store.size, 1);

const second = await sendEmailsAfterConfirm(env, [row], portalBody);
assert.equal(second.summary.emailsSent, 0);
assert.equal(second.summary.emailsAlreadySent, 1);
assert.equal(second.summary.emailsFailed, 0);
assert.equal(second.emailResults[0].status, 'ALREADY_SENT');
assert.equal(second.emailResults[0].ok, true);
assert.equal(sentPayloads.length, 1, 'the same email must not be delivered twice');

const changedSession = { ...row, LessonDated:'14th September 2026' };
const third = await sendEmailsAfterConfirm(env, [changedSession], portalBody);
assert.equal(third.summary.emailsSent, 1);
assert.equal(third.summary.emailsAlreadySent, 0);
assert.equal(third.summary.emailsFailed, 0);
assert.equal(sentPayloads.length, 2, 'a genuinely different lesson session may send a new email');

console.log('Parent email duplicate-send protection: PASS');
