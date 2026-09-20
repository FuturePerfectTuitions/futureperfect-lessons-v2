import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin-import.html', import.meta.url), 'utf8');
const manualJs = readFileSync(new URL('../assets/admin-import-manual-email.js', import.meta.url), 'utf8');
const legacyGate = readFileSync(new URL('../worker/src/admin-lesson-release-import-manual-email.js', import.meta.url), 'utf8');
const reconciledGate = readFileSync(new URL('../worker/src/admin-lesson-release-import-manual-email-reconciled.js', import.meta.url), 'utf8');
const production = readFileSync(new URL('../worker/src/index-phase20-change17-parent-email.js', import.meta.url), 'utf8');

assert.match(html, /Parent emails are not sent automatically/);
assert.match(html, /id="sendEmailsBtn"[^>]*disabled>Send Parent Emails</);
assert.ok(
  html.indexOf('assets/admin-import-manual-email.js') < html.indexOf('assets/admin-import.js'),
  'manual-email fetch gate must load before the automatic importer'
);

// Preserve the original manual-email semantics as a regression anchor.
assert.match(legacyGate, /body\.sendEmails === true/);
assert.match(legacyGate, /return handleEmailImport\(request, env\)/);
assert.match(legacyGate, /handleBaseImport\(normalizedRequest, env\)/);
assert.match(legacyGate, /emailSendDeferred:true/);

// Production now routes through the reconciled equivalent: automatic imports
// reconcile Portal access before reporting success, while manual parent emails
// remain opt-in and are sent only after the reconciled Portal action succeeds.
assert.match(reconciledGate, /body\.sendEmails === true/);
assert.match(reconciledGate, /return handleEmailImport\(request, env\)/);
assert.match(reconciledGate, /handleReconciledBase\(normalizedRequest, env\)/);
assert.match(reconciledGate, /emailSendDeferred:true/);
assert.match(production, /admin-lesson-release-import-manual-email-reconciled\.js/);

assert.match(manualJs, /sendEmails:true/);
assert.match(manualJs, /Send Parent Emails/);
assert.match(manualJs, /Parent emails are being sent now/);
assert.doesNotMatch(manualJs, /\.click\(\).*sendEmailsBtn/);

console.log('Automatic Portal import with reconciled access + manual parent-email send control: PASS');
