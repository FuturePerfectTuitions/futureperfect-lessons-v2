import fs from 'node:fs';

const secretPath = String(process.env.CP12_PERSONA_SECRETS || '/tmp/cp12-production-real-persona-secrets.json').trim();
const credentialShape = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/;
const clean = value => String(value ?? '').trim();

function requireText(value, label) {
  const out = clean(value);
  if (!out) throw new Error(`${label} is missing.`);
  return out;
}

function requireCredential(value, label) {
  const out = String(value ?? '');
  if (!credentialShape.test(out)) throw new Error(`${label} has invalid shape.`);
  return out;
}

if (!fs.existsSync(secretPath)) throw new Error('Real-persona secret file is missing.');
const payload = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
const ordinary = payload?.ordinary || {};
const vr = payload?.vr || {};

const vrUsername = requireText(vr.username, 'VR username');
const ordinaryUsername = requireText(ordinary.username, 'ordinary username');
if (vrUsername.toLowerCase() === 'admin' || ordinaryUsername.toLowerCase() === 'admin') {
  throw new Error('Production UAT cannot use the admin superuser as a student persona.');
}
if (vrUsername.toLowerCase() === ordinaryUsername.toLowerCase()) {
  throw new Error('Production UAT requires distinct ordinary and 11+ student personas.');
}

const uatEnv = {
  UAT_VR_USERNAME: vrUsername,
  UAT_VR_LOGIN_PASSWORD: requireCredential(vr.password, 'VR login password'),
  UAT_VR_ANSWER_PASSWORD: requireCredential(vr.answerPassword, 'VR Answer Pack password'),
  UAT_VR_EXPECTED_FIRST_NAME: requireText(vr.firstName, 'VR first name'),
  UAT_ORDINARY_USERNAME: ordinaryUsername,
  UAT_ORDINARY_LOGIN_PASSWORD: requireCredential(ordinary.password, 'ordinary login password'),
  UAT_ORDINARY_EXPECTED_FIRST_NAME: requireText(ordinary.firstName, 'ordinary first name')
};

for (const [key, value] of Object.entries(uatEnv)) process.env[key] = value;

try {
  await import(`./cp12-approved-v2-ui-production-uat.mjs?real-persona=${Date.now()}`);
} finally {
  for (const key of Object.keys(uatEnv)) delete process.env[key];
  try { fs.unlinkSync(secretPath); } catch {}
}
