import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin-import.html', import.meta.url), 'utf8');
const manualJs = readFileSync(new URL('../assets/admin-import-manual-email.js', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../worker/src/admin-lesson-release-import-manual-email.js', import.meta.url), 'utf8');
const production = readFileSync(new URL('../worker/src/index-phase20-change17-parent-email.js', import.meta.url), 'utf8');

assert.match(html, /Parent emails are not sent automatically/);
assert.match(html, /id="sendEmailsBtn"[^>]*disabled>Send Parent Emails</);
assert.ok(
  html.indexOf('assets/admin-import-manual-email.js') < html.indexOf('assets/admin-import.js'),
  'manual-email fetch gate must load before the automatic importer'
);

assert.match(gate, /body\.sendEmails === true/);
assert.match(gate, /return handleEmailImport\(request, env\)/);
assert.match(gate, /handleBaseImport\(normalizedRequest, env\)/);
assert.match(gate, /emailSendDeferred:true/);
assert.match(production, /admin-lesson-release-import-manual-email\.js/);

assert.match(manualJs, /sendEmails:true/);
assert.match(manualJs, /Send Parent Emails/);
assert.match(manualJs, /Parent emails are being sent now/);
assert.doesNotMatch(manualJs, /\.click\(\).*sendEmailsBtn/);

console.log('Automatic Portal import with manual parent-email send control: PASS');
