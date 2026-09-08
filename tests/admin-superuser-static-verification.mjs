import fs from 'node:fs';

const wrapperPath = 'worker/src/index-phase20-change18-admin-superuser.js';
const fastPathPath = 'worker/src/index-phase20-change19-admin-fast.js';
const change16Path = 'worker/src/index-phase20-change16.js';
const wranglerPath = 'worker/wrangler.toml';
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const fastPath = fs.readFileSync(fastPathPath, 'utf8');
const change16 = fs.readFileSync(change16Path, 'utf8');
const wrangler = fs.readFileSync(wranglerPath, 'utf8');

const requiredLibraries = [
  'MATHS_Y2_FULL','MATHS_Y3_FULL','MATHS_Y4_FULL','MATHS_Y5_FULL','MATHS_Y6_FULL',
  'MATHS_L1_FULL','MATHS_L2_FULL','MATHS_L3_FULL',
  'ENGLISH_Y2_FULL','ENGLISH_Y3_FULL','ENGLISH_Y4_FULL','ENGLISH_Y5_FULL','ENGLISH_Y6_FULL',
  'ENGLISH_Y4_11PLUS_FULL','ENGLISH_Y5_11PLUS_FULL'
];
for (const code of requiredLibraries) {
  if (!wrapper.includes(`'${code}'`)) throw new Error(`Missing admin Full Library code: ${code}`);
}

const requiredSpecials = ['Y4MAssT1','Y4MAssT2','Y5MAssT1','Y5MAssT2','VR_HOWTO','MOCKS'];
for (const bucket of requiredSpecials) {
  if (!wrapper.includes(`'${bucket}'`)) throw new Error(`Missing admin special bucket: ${bucket}`);
}

const requiredMarkers = [
  "DEFAULT_ADMIN_SUPERUSER_IDS = Object.freeze(['admin'])",
  "role: 'admin'",
  'superuser: true',
  'blockedLessons: []',
  "const ADMIN_MOCK_ALIAS = 'ADMIN_MOCKS'",
  "parts[1] !== 'answer'",
  "accessMode: 'admin-superuser'",
  "source: 'adminSuperuser'"
];
for (const marker of requiredMarkers) {
  if (!wrapper.includes(marker)) throw new Error(`Missing admin-superuser marker: ${marker}`);
}

if (!fastPath.includes("body?.superuser === true") || !fastPath.includes("body?.role")) {
  throw new Error('Admin fast path is not gated by authenticated superuser session state.');
}
if (!fastPath.includes("ADMIN_SUPERUSER_FAST_PATH")) {
  throw new Error('Admin fast path marker is not supplied.');
}
if (!change16.includes("env?.ADMIN_SUPERUSER_FAST_PATH === true")) {
  throw new Error('Change 16 does not bypass the redundant home probe for authenticated Admin.');
}
if (!wrangler.includes('main = "src/index-phase20-change19-admin-fast.js"')) {
  throw new Error('Production entrypoint is not the Admin fast-path wrapper.');
}

console.log('ADMIN_SUPERUSER_STATIC_VERIFICATION_PASS');
