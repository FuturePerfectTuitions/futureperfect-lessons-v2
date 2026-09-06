import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const token = String(process.env.CLOUDFLARE_API_TOKEN || '');
if (!token) throw new Error('Missing Cloudflare token');

const wrappedPrivate = JSON.parse(fs.readFileSync('.secure-provisioning/private.enc.json', 'utf8'));
if (wrappedPrivate.schema !== 'fpt-prod-private-key-wrap-v1') throw new Error('Unexpected private-key envelope');
const wrapKey = crypto.createHash('sha256').update('fpt-prod-provision-wrap-v1\0').update(token).digest();
const privateDecipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(wrappedPrivate.iv, 'base64'));
privateDecipher.setAuthTag(Buffer.from(wrappedPrivate.tag, 'base64'));
const privatePem = Buffer.concat([
  privateDecipher.update(Buffer.from(wrappedPrivate.ciphertext, 'base64')),
  privateDecipher.final()
]).toString('utf8');

const envelope = JSON.parse(fs.readFileSync('.secure-provisioning/payload.enc.json', 'utf8'));
if (envelope.schema !== 'fpt-prod-payload-envelope-v1') throw new Error('Unexpected payload envelope');
const dataKey = crypto.privateDecrypt({
  key: privatePem,
  oaepHash: 'sha256',
  padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
}, Buffer.from(envelope.wrappedKey, 'base64'));
const payloadDecipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(envelope.iv, 'base64'));
payloadDecipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
const plaintext = Buffer.concat([
  payloadDecipher.update(Buffer.from(envelope.ciphertext, 'base64')),
  payloadDecipher.final()
]);
const payload = JSON.parse(plaintext.toString('utf8'));
if (payload.schema !== 'fpt-portal-v2-production-provision-v1') throw new Error('Unexpected provisioning schema');
if (payload.expectedStudentCount !== 13 || !Array.isArray(payload.students) || payload.students.length !== 13) throw new Error('Student count mismatch');

const moduleUrl = pathToFileURL(process.cwd() + '/worker/src/phase11-navigation-manifest.generated.js').href;
const { PHASE11_NAVIGATION_MANIFEST: manifest } = await import(moduleUrl);

const viewCurricula = {
  'maths-year2': ['MATHS_Y2'],
  'maths-year3': ['MATHS_Y3'],
  'maths-year4': ['MATHS_L1'],
  'maths-year5': ['MATHS_L2'],
  'maths-year6': ['MATHS_L3', 'MATHS_Y6_EXTRA'],
  'english-year2': ['ENGLISH_Y2'],
  'english-year3': ['ENGLISH_Y3'],
  'english-year4': ['ENGLISH_Y4'],
  'english-year5': ['ENGLISH_Y5'],
  'english-year6': ['ENGLISH_Y6']
};
const fullLibraryViews = {
  ENGLISH_Y4_11PLUS_FULL: ['english-year4-11plus', ['ENGLISH_Y4']],
  ENGLISH_Y5_11PLUS_FULL: ['english-year5-11plus', ['ENGLISH_Y5']],
  MATHS_L1_FULL: ['maths-level1', ['MATHS_L1']],
  MATHS_L2_FULL: ['maths-level2', ['MATHS_L2']],
  MATHS_L3_FULL: ['maths-level3', ['MATHS_L3']],
  MATHS_Y6_FULL: ['maths-year6', ['MATHS_L3', 'MATHS_Y6_EXTRA']],
  ENGLISH_Y4_FULL: ['english-year4', ['ENGLISH_Y4']],
  ENGLISH_Y5_FULL: ['english-year5', ['ENGLISH_Y5']]
};

const validPassword = value => {
  const s = String(value || '');
  return s.length === 4 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);
};
const idsForCurricula = curricula => {
  const ids = [];
  for (const code of curricula) {
    const list = manifest.curricula?.[code]?.lessonIds;
    if (!Array.isArray(list)) throw new Error(`Missing curriculum ${code}`);
    for (const lessonId of list) {
      const lesson = manifest.lessons?.[lessonId];
      if (lesson && lesson.active !== false) ids.push(String(lessonId));
    }
  }
  return [...new Set(ids)];
};

const seen = new Set();
const pairs = [];
const metaStudents = [];
for (const source of payload.students) {
  const portalUserId = String(source.portalUserId || '').trim();
  const id = portalUserId.toLowerCase();
  if (!id || seen.has(id)) throw new Error('Duplicate or blank Portal User ID');
  seen.add(id);
  if (!validPassword(source.p) || !validPassword(source.answerPassword)) throw new Error(`Credential format invalid for ${id}`);

  const manualViews = Array.isArray(source.manualFullViews) ? source.manualFullViews : [];
  const manualCore = [];
  const expectedViews = [];
  for (const viewId of manualViews) {
    const curricula = viewCurricula[String(viewId)];
    if (!curricula) throw new Error(`Unsupported manual full view ${viewId}`);
    const lessonIds = idsForCurricula(curricula);
    if (!lessonIds.length) throw new Error(`Empty manual full view ${viewId}`);
    manualCore.push(...lessonIds);
    expectedViews.push({ viewId: String(viewId), expectedOpen: lessonIds.length });
  }

  const libraries = Array.isArray(source.fullLibraries) ? source.fullLibraries.map(String) : [];
  for (const library of libraries) {
    const rule = fullLibraryViews[library];
    if (!rule) throw new Error(`Unsupported Full Library ${library}`);
    expectedViews.push({ viewId: rule[0], expectedOpen: idsForCurricula(rule[1]).length });
  }

  const manualAccess = {
    coreLessons: [...new Set(manualCore)],
    vrLessons: [],
    specialBuckets: []
  };
  const record = {
    portalUserId,
    firstName: String(source.firstName || '').trim(),
    p: String(source.p),
    answerPassword: String(source.answerPassword),
    status: 'active',
    expires: '',
    schoolYear: source.schoolYear == null ? null : Number(source.schoolYear),
    batches: [],
    vrEligible: source.vrEligible === true,
    fullLibraries: libraries,
    manualAccess,
    blockedLessons: []
  };
  if (!record.firstName) throw new Error(`Missing first name for ${id}`);

  pairs.push({ key: `user:${id}`, value: JSON.stringify(record) });
  metaStudents.push({ id, firstName: record.firstName, expectedViews, manualCoreCount: manualAccess.coreLessons.length, fullLibraryCount: libraries.length });
}

const noAccess = new Set(['rei0710', 'mahu1907', 'meh0510']);
for (const item of metaStudents) {
  if (noAccess.has(item.id)) {
    if (item.manualCoreCount !== 0 || item.fullLibraryCount !== 0 || item.expectedViews.length !== 0) throw new Error(`No-access account ${item.id} received access`);
  }
}
if (seen.size !== 13) throw new Error('Unique student count mismatch');

fs.writeFileSync('/tmp/fpt-provision-payload.json', JSON.stringify(payload), { mode: 0o600 });
fs.writeFileSync('/tmp/fpt-provision-bulk.json', JSON.stringify(pairs), { mode: 0o600 });
fs.writeFileSync('/tmp/fpt-provision-meta.json', JSON.stringify({ students: metaStudents }), { mode: 0o600 });
fs.writeFileSync('/tmp/fpt-expected-user-keys.txt', pairs.map(item => item.key).sort().join('\n') + '\n', { mode: 0o600 });

console.log('SECURE_PAYLOAD_DECRYPT_AND_VALIDATE_PASS students=13');
