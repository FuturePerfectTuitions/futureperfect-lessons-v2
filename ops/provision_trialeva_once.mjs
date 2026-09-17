import crypto from 'node:crypto';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
if (!accountId || !token) throw new Error('Cloudflare deployment credentials are required.');

const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0tOF+ArNn2ZNxYmRvezc
JXD3uLgh6TUkS/F+q0rwr+Bq6RXeuC6PTe0uYm7hoVRcgsluY8cMlRqJBwaNZFLi
pYLfuu+eA8aAxAnOjS+PBSGUSKLly9uutjQDRi1MZn9SiJxqZuEs8R2NXcaC64HD
3QcFEd9Ov/SN0v3MoE6I2HkXnDwq3BX+nRZMZAQTg0TGcGa3kemu62ldpbRBxGo1
XzgrkpR8ColMDidS7r14zyGRH9DW1Z/rPnJ7+2n94iO5LR7Hiot/MqQHXhXbgq4v
iMXyl/CaBTuab2+LaOreVVGCE3xdSEH59oPmy57V9M1ONfRs1glgd0yamWzPPZiT
8wIDAQAB
-----END PUBLIC KEY-----`;

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = { Authorization: `Bearer ${token}` };

async function cf(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

function randomFrom(chars) {
  return chars[crypto.randomInt(chars.length)];
}

function password(excluded = new Set()) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  for (;;) {
    const chars = [randomFrom(upper), randomFrom(lower), randomFrom(digits), randomFrom(all)];
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const value = chars.join('');
    if (value !== 'Csl1' && !excluded.has(value)) return value;
  }
}

const settings = await cf(`/workers/scripts/${encodeURIComponent(workerName)}/settings`);
if (!settings.response.ok || settings.body?.success !== true) throw new Error('Could not read Worker bindings.');
const studentsBinding = settings.body.result.bindings.find(item => item.name === 'STUDENTS_KV' && item.type === 'kv_namespace');
const dbBinding = settings.body.result.bindings.find(item => item.name === 'DB' && item.type === 'd1');
const studentsId = studentsBinding?.namespace_id;
const dbId = dbBinding?.id;
if (!studentsId || !dbId) throw new Error('Required production bindings were not found.');

const keyPath = `/storage/kv/namespaces/${encodeURIComponent(studentsId)}/values/${encodeURIComponent('user:trialeva')}`;
const existing = await cf(keyPath);
if (existing.response.status === 200) throw new Error('TrialEva already exists; refusing to overwrite it.');
if (existing.response.status !== 404) throw new Error(`Unexpected TrialEva lookup status ${existing.response.status}.`);

const loginPassword = password();
const answerPassword = password(new Set([loginPassword]));
const record = {
  schemaVersion: 1,
  portalUserId: 'TrialEva',
  firstName: 'Eva',
  name: 'Eva',
  p: loginPassword,
  loginPassword,
  answerPassword,
  status: 'active',
  accountStatus: 'active',
  expires: '',
  expiresOn: null,
  schoolYear: 4,
  vrEligible: true,
  mathsYears: [],
  vrBuckets: [],
  entitlements: {},
  batches: [],
  fullLibraries: [],
  manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] },
  manualLessonAccess: {},
  specialAccess: [],
  trialViews: ['maths-level1', 'maths-level2', 'english-year4-11plus']
};

const d1 = await cf(`/d1/database/${encodeURIComponent(dbId)}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: "DELETE FROM trial_login_consumptions WHERE portal_user_id_norm='trialeva'" })
});
if (!d1.response.ok || d1.body?.success !== true) throw new Error('Could not reset TrialEva trial-consumption state.');

const written = await cf(keyPath, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(record)
});
if (!written.response.ok) throw new Error('Could not write TrialEva to production KV.');

const readback = await cf(keyPath);
if (!readback.response.ok) throw new Error('Could not verify TrialEva production KV record.');
const user = readback.body;
const viewsOk = Array.isArray(user?.trialViews) && user.trialViews.join('|') === 'maths-level1|maths-level2|english-year4-11plus';
if (user?.portalUserId !== 'TrialEva' || user?.p !== loginPassword || user?.answerPassword !== answerPassword || !viewsOk) {
  throw new Error('TrialEva readback verification failed.');
}

const verifyConsumption = await cf(`/d1/database/${encodeURIComponent(dbId)}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: "SELECT COUNT(*) AS count FROM trial_login_consumptions WHERE portal_user_id_norm='trialeva'" })
});
const count = Number(verifyConsumption.body?.result?.[0]?.results?.[0]?.count ?? -1);
if (!verifyConsumption.response.ok || verifyConsumption.body?.success !== true || count !== 0) {
  throw new Error('TrialEva one-login state is not clean.');
}

const plaintext = Buffer.from(JSON.stringify({
  portalUserId: 'TrialEva',
  loginPassword,
  answerPassword,
  trialViews: record.trialViews,
  oneLoginUnused: true
}));
const ciphertext = crypto.publicEncrypt({
  key: publicKey,
  padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256'
}, plaintext);

console.log(`TRIALEVA_CREDENTIALS_RSA_OAEP_BASE64=${ciphertext.toString('base64')}`);
console.log('TRIALEVA_PROVISIONED_AND_VERIFIED');