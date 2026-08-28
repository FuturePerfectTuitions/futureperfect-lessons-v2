import fs from 'node:fs';

const config = fs.readFileSync('config.js', 'utf8');
const efficient = fs.readFileSync('worker/src/index-phase11-efficient.js', 'utf8');
const worker = fs.readFileSync('worker/src/phase11-vr-howto.js', 'utf8');
const frontend = fs.readFileSync('assets/phase11-vr-howto.js', 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText(config, 'assets/phase11-vr-howto.js', 'Phase 11 frontend loader');
requireText(config, '/\\/phase11\\.html$/', 'Phase 11-only loader guard');
requireText(efficient, "import phase11Worker from './phase11-vr-howto.js';", 'VR How To Worker composition');

requireText(worker, "'english-year4-11plus'", 'Year 4 11+ eligibility');
requireText(worker, "'english-year5-11plus'", 'Year 5 11+ eligibility');
requireText(worker, 'body.view.lockedPreview', 'locked-preview denial');
requireText(worker, "user?.manualAccess?.specialBuckets", 'manual special-bucket source');
requireText(worker, "manualSpecialBuckets(user).has(VR_HOWTO_BUCKET)", 'manual VR How To grant gate');
requireText(worker, "'SPECIAL_ACCESS_REQUIRED'", 'manual-access denial');
requireText(worker, "String(area?.bucketId || '') !== VR_HOWTO_BUCKET", 'legacy lesson-list placement removal');
requireText(worker, "url.pathname === `/api/v1/student/special-areas/${VR_HOWTO_BUCKET}`", 'VR How To detail route');
requireText(worker, "accessSource: 'manualAccess.specialBuckets+open-english-11plus-view'", 'manual plus open-view access source');
requireText(worker, 'SPECIAL_RESOURCE_NOT_FOUND', 'gated VR How To video route');

requireText(frontend, "title.textContent = 'VR How To';", 'top-level card title');
requireText(frontend, "card.id = 'phase11-vr-howto-card';", 'unique top-level card');
requireText(frontend, "target.after(card);", 'placement beside eligible 11+ Year card');
requireText(frontend, "'/api/v1/student/home'", 'home-derived view candidate');
requireText(frontend, '/api/v1/student/special-areas/VR_HOWTO?viewId=', 'server-authorised VR How To eligibility/detail request');
requireText(frontend, "access?.area?.bucketId !== 'VR_HOWTO'", 'manual-access UI visibility gate');
requireText(frontend, '/api/v1/student/special-resources/', 'VR How To special-video request');

if (frontend.includes('vrprevideo') || frontend.includes('vrhomeworkvideo')) {
  throw new Error('Top-level VR How To frontend must not re-enable lesson-specific VR videos.');
}

console.log('Phase 11 top-level VR How To static verification: PASS');
