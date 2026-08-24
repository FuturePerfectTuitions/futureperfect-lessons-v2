import fs from 'node:fs';
import path from 'node:path';
import { loadPhase11Catalogue, validatePhase11Catalogue, buildPhase11KvBulk } from './phase11-catalogue.mjs';
import { loadPhase11TestPersonas, buildPhase11TestSeed } from './phase11-test-personas.mjs';

const BASE_ALLOWLIST = ['test0101','test0202','test0303','test0404','test0505','test0606','test0707'];
const HISTORY_ROWS = [
  ['test0707','Y3M1',1,0,'Y3MDEVHIST','2024-09-01'],
  ['test0707','Y4M2',1,0,'Y4MDEVHIST','2025-09-01'],
  ['test0707','Y5M1',1,0,'Y5MDEVHIST','2026-08-21'],
  ['test0707','Y4E1',1,0,'Y4EDEVHIST','2025-09-01'],
  ['test0707','Y5E2',1,0,'Y5EDEVHIST','2026-08-21']
];
const HISTORY_TIMESTAMP = '2026-08-24T08:20:00.000Z';

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function historySql(catalogue) {
  for (const [, lessonId] of HISTORY_ROWS) {
    if (!catalogue.lessons?.[lessonId]) throw new Error(`History regression lesson is not canonical: ${lessonId}`);
  }
  const values = HISTORY_ROWS.map(([user, lessonId, core, vr, batch, date]) => `(${[
    quote(user), quote(lessonId), core, vr, quote('excel'), quote(HISTORY_TIMESTAMP), quote(HISTORY_TIMESTAMP), quote(batch), quote(date)
  ].join(',')})`).join(',\n');
  return `DELETE FROM lesson_entitlements WHERE portal_user_id_norm = 'test0707';\nINSERT INTO lesson_entitlements (portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date) VALUES\n${values};\n`;
}

export function buildPhase11ApplyPackage() {
  const catalogue = loadPhase11Catalogue();
  const catalogueValidation = validatePhase11Catalogue(catalogue);
  const personas = loadPhase11TestPersonas();
  const testSeed = buildPhase11TestSeed(catalogue, personas);
  const allowlist = [...BASE_ALLOWLIST, ...personas.personas.map(item => item.portalUserIdNorm)];
  if (new Set(allowlist).size !== allowlist.length) throw new Error('Development allowlist contains duplicate IDs.');

  return {
    catalogue,
    catalogueKvRows: buildPhase11KvBulk(catalogue),
    testStudentKvRows: testSeed.studentKvRows,
    testEntitlementsSql: testSeed.d1Sql,
    historyEntitlementsSql: historySql(catalogue),
    allowlist,
    summary: {
      phase: 11,
      catalogueLessons: catalogueValidation.lessons,
      catalogueCurricula: catalogueValidation.curricula,
      lessonsKvWrites: catalogueValidation.kvKeys,
      r2References: catalogueValidation.r2Keys,
      testPersonas: testSeed.validation.personas,
      testPersonaEntitlementRows: testSeed.validation.entitlementRows,
      testPersonaVrRows: testSeed.validation.vrRows,
      historyRegressionRows: HISTORY_ROWS.length,
      developmentAllowlistCount: allowlist.length
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv.indexOf('--write-dir');
  if (arg < 0 || !process.argv[arg + 1]) throw new Error('Usage: node scripts/phase11-apply-package.mjs --write-dir <directory>');
  const out = path.resolve(process.argv[arg + 1]);
  fs.mkdirSync(out, { recursive: true });
  const pkg = buildPhase11ApplyPackage();
  fs.writeFileSync(path.join(out, 'phase11-lessons-kv-bulk.json'), JSON.stringify(pkg.catalogueKvRows), 'utf8');
  fs.writeFileSync(path.join(out, 'phase11-test-students-kv-bulk.json'), JSON.stringify(pkg.testStudentKvRows), 'utf8');
  fs.writeFileSync(path.join(out, 'phase11-test-entitlements.sql'), pkg.testEntitlementsSql, 'utf8');
  fs.writeFileSync(path.join(out, 'phase11-history-entitlements.sql'), pkg.historyEntitlementsSql, 'utf8');
  fs.writeFileSync(path.join(out, 'phase11-dev-allowlist.txt'), pkg.allowlist.join(','), 'utf8');
  fs.writeFileSync(path.join(out, 'phase11-apply-summary.json'), JSON.stringify(pkg.summary, null, 2), 'utf8');
  console.log(JSON.stringify(pkg.summary, null, 2));
}
