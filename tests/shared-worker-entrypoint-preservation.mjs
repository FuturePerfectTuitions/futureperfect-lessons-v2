import fs from 'node:fs';

const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');
const bridge = fs.readFileSync('worker/src/index-step10-quiz-bridge.js', 'utf8');
const admin = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
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
must(admin, "./admin-resource-replace-consistency.js", 'Admin Replace Resource consistency composition');
must(replaceConsistency, "replace-resource-consistency-v1", 'Admin Replace Resource consistency marker');
must(deploy, 'CONFIG_ENTRYPOINT=', 'deployment derives canonical entrypoint from wrangler');
must(deploy, 'WORKER_ENTRYPOINT="${WORKER_ENTRYPOINT:-$CONFIG_ENTRYPOINT}"', 'deployment preserves explicit override only when requested');

console.log('SHARED_WORKER_ENTRYPOINT_PRESERVATION_PASS');
