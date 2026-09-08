import fs from 'node:fs';

const wrapperPath = 'worker/src/index-phase20-change18-admin-superuser.js';
const wranglerPath = 'worker/wrangler.toml';
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
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

if (!wrangler.includes('main = "src/index-phase20-change18-admin-superuser.js"')) {
  throw new Error('Production entrypoint is not the admin-superuser wrapper.');
}

console.log('ADMIN_SUPERUSER_STATIC_VERIFICATION_PASS');
