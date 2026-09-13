import fs from 'node:fs';

const baseline = 'e4c7bde7ad9a9402136da5798d7ab690ab30322c';
const productionWorker = 'fpt-portal-v2-worker';
const cases = [
  {
    role: 'student',
    source: 'rebuild/student/src/index.js',
    config: 'rebuild/student/wrangler.toml',
    dev: 'fpt-portal-v2-rebuild-student-dev',
    staging: 'fpt-portal-v2-rebuild-student-staging'
  },
  {
    role: 'admin-operations',
    source: 'rebuild/adminops/src/index.js',
    config: 'rebuild/adminops/wrangler.toml',
    dev: 'fpt-portal-v2-rebuild-adminops-dev',
    staging: 'fpt-portal-v2-rebuild-adminops-staging'
  }
];

for (const item of cases) {
  const source = fs.readFileSync(item.source, 'utf8');
  const config = fs.readFileSync(item.config, 'utf8');
  if (!source.includes("url.pathname === '/health'")) throw new Error(`${item.role}: health route missing`);
  if (!source.includes(`runtime: '${item.role}'`)) throw new Error(`${item.role}: runtime marker missing`);
  if (!source.includes(`const BASELINE_SOURCE_SHA = '${baseline}'`)) throw new Error(`${item.role}: baseline SHA missing`);
  if (!source.includes('productionTarget: false')) throw new Error(`${item.role}: production-target guard missing`);
  if (!config.includes(`name = "${item.dev}"`)) throw new Error(`${item.role}: development identity missing`);
  if (!config.includes(`name = "${item.staging}"`)) throw new Error(`${item.role}: staging identity missing`);
  if (!config.includes('workers_dev = true')) throw new Error(`${item.role}: workers.dev must be enabled`);
  if (!config.includes('ENVIRONMENT = "staging"')) throw new Error(`${item.role}: staging environment marker missing`);
  if (!config.includes(`BASELINE_SOURCE_SHA = "${baseline}"`)) throw new Error(`${item.role}: config baseline SHA missing`);
  if (config.includes(productionWorker + '"') || config.includes(`name = "${productionWorker}"`)) {
    throw new Error(`${item.role}: production Worker identity must not appear as a deploy target`);
  }
  for (const forbidden of ['[[kv_namespaces]]', '[[d1_databases]]', '[[r2_buckets]]', '[[send_email]]', 'route =', 'routes =']) {
    if (config.includes(forbidden)) throw new Error(`${item.role}: forbidden Checkpoint 1 binding/route found: ${forbidden}`);
  }
}

const studentConfig = fs.readFileSync(cases[0].config, 'utf8');
const adminConfig = fs.readFileSync(cases[1].config, 'utf8');
if (studentConfig === adminConfig) throw new Error('Student and Admin/Operations configs must remain separate.');

console.log('REBUILD_CHECKPOINT1_STATIC_VERIFICATION_PASS');
