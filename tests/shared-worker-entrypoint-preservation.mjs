// deploy-trigger: maths-equivalent-navigation-final-v5-native-authority
import fs from 'node:fs';

const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');
const bridge = fs.readFileSync('worker/src/index-step10-quiz-bridge.js', 'utf8');
const admin = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
const finalMathsNavigation = fs.readFileSync('worker/src/index-maths-equivalent-navigation-final.js', 'utf8');
const liveCatalogueOverlay = fs.readFileSync('worker/src/live-student-catalogue-overlay.js', 'utf8');
const reconciledImport = fs.readFileSync('worker/src/admin-lesson-release-import-reconciled.js', 'utf8');
const readModelSyncV2 = fs.readFileSync('worker/src/access-read-model-sync-v2.js', 'utf8');
const replaceConsistency = fs.readFileSync('worker/src/admin-resource-replace-consistency.js', 'utf8');
const deploy = fs.readFileSync('ops/deploy_current_worker_preserve.sh', 'utf8');

function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

must(wrangler, 'main = "src/index-step10-quiz-bridge.js"', 'wrangler canonical entrypoint');
must(bridge, "import currentWorker from './index-admin-tools.js';", 'quiz bridge composition');
must(bridge, "'/api/v1/quiz-bridge/redeem'", 'quiz redeem route');
must(bridge, "'/api/v1/student/quiz/eligibility'", 'legacy quiz eligibility route');
must(bridge, "'/api/v1/student/quiz/launch'", 'legacy quiz launch route');
must(bridge, "const RELEASE_SOURCE='portal-live-maths11plus-release-v2'", 'L2/L3 release context marker');
must(admin, "import currentWorker from './index-maths-equivalent-navigation-final.js';", 'final Maths navigation composition');
must(finalMathsNavigation, "import currentWorker from './index-phase24-trial-vr.js';", 'final Maths navigation preserves current student chain');
must(finalMathsNavigation, "import nativePreparedWorker from './index-phase20-change14.js';", 'final Maths navigation reads raw prepared authority');
must(finalMathsNavigation, 'maths-equivalent-navigation-final-v5-native-authority', 'final Maths navigation live marker');
must(finalMathsNavigation, "url.pathname === '/api/v1/student/home'", 'final Maths home interception');
must(finalMathsNavigation, 'nativeCurrentMathsAuthority', 'prepared programme authority');
must(finalMathsNavigation, 'reconcileNativeMathsHome', 'native prepared-model reconciliation');
must(finalMathsNavigation, 'YEAR6_SATS_VIEW', 'native SATS view routing');
must(liveCatalogueOverlay, 'LIVE_ENTITLEMENT_BATCH_DEFINITION_V1', 'batch-definition entitlement classification marker');
must(liveCatalogueOverlay, 'LEFT JOIN batch_definitions b ON b.batch_key = e.source_batch_code', 'full entitlement batch-definition join');
must(liveCatalogueOverlay, 'LEFT JOIN batch_definitions b ON b.batch_key = e.batch_key', 'prelesson entitlement batch-definition join');
must(reconciledImport, "from './access-read-model-sync-v2.js';", 'lesson-release read-model reconciliation v2 composition');
must(readModelSyncV2, 'd1-authoritative-sats-presentation-v2', 'authoritative read-model reconciliation marker');
must(readModelSyncV2, 'compileLegacyAccessScope', 'reconciliation preserves existing compiler features');
must(readModelSyncV2, 'normaliseAuthoritativeInput', 'D1 programme authority normalization');
must(readModelSyncV2, 'decorateAuthoritativeSnapshot', 'SATS presentation isolation');
must(admin, "./admin-resource-replace-consistency.js", 'Admin Replace Resource consistency composition');
must(replaceConsistency, "replace-resource-consistency-v1", 'Admin Replace Resource consistency marker');
must(deploy, 'CONFIG_ENTRYPOINT=', 'deployment derives canonical entrypoint from wrangler');
must(deploy, 'WORKER_ENTRYPOINT="${WORKER_ENTRYPOINT:-$CONFIG_ENTRYPOINT}"', 'deployment preserves explicit override only when requested');

console.log('SHARED_WORKER_ENTRYPOINT_PRESERVATION_PASS');