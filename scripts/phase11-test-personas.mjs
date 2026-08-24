import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhase11Catalogue } from './phase11-catalogue.mjs';

const TEST_DATE = '2026-08-24';
const TEST_TIMESTAMP = '2026-08-24T08:15:00.000Z';

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function validFourCharacterPassword(value) {
  const password = String(value || '');
  return password.length === 4 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function sql(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function batchForCurriculum(persona, curriculumCode) {
  const batches = Array.isArray(persona?.user?.batches)
    ? persona.user.batches.map(value => String(value).toUpperCase())
    : [];
  const year = Number(persona?.user?.schoolYear || 0);
  const find = regex => batches.find(code => regex.test(code)) || null;

  switch (curriculumCode) {
    case 'ENGLISH_Y2': return find(/^Y2E/);
    case 'MATHS_Y2': return find(/^Y2M/);
    case 'ENGLISH_Y4': return find(/^Y4E/);
    case 'MATHS_L1': return find(/^Y4M(?!11)/);
    case 'ENGLISH_Y5': return find(/^Y5E/);
    case 'MATHS_L2': return year === 4 ? find(/^Y4M11/) : find(/^Y5M(?!11)/);
    case 'MATHS_L3': return find(/^Y5M11/);
    default: return null;
  }
}

export function loadPhase11TestPersonas(root = repoRoot()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'phase11', 'test_personas.json'), 'utf8'));
}

export function validatePhase11TestPersonas(catalogue, manifest) {
  if (manifest?.phase !== 11 || manifest?.schemaVersion !== 1) throw new Error('Unexpected Phase 11 test-persona manifest.');
  if (!validFourCharacterPassword(manifest.sharedLoginPassword) || !validFourCharacterPassword(manifest.sharedAnswerPassword)) {
    throw new Error('Shared test passwords do not satisfy the four-character rule.');
  }
  const personas = Array.isArray(manifest.personas) ? manifest.personas : [];
  if (personas.length !== 9) throw new Error(`Expected 9 owner-requested test personas; found ${personas.length}.`);

  const ids = new Set();
  let entitlementRows = 0;
  let vrRows = 0;
  for (const persona of personas) {
    const norm = String(persona.portalUserIdNorm || '').trim().toLowerCase();
    if (!norm || norm !== String(persona.portalUserId || '').trim().toLowerCase()) throw new Error(`Bad Portal User ID normalisation for ${persona.portalUserId}.`);
    if (ids.has(norm)) throw new Error(`Duplicate test Portal User ID ${norm}.`);
    ids.add(norm);
    const user = persona.user || {};
    if (user.p !== manifest.sharedLoginPassword || user.answerPassword !== manifest.sharedAnswerPassword) throw new Error(`Password mismatch for ${persona.portalUserId}.`);
    if (!validFourCharacterPassword(user.p) || !validFourCharacterPassword(user.answerPassword)) throw new Error(`Invalid password for ${persona.portalUserId}.`);
    if (![2,4,5].includes(Number(user.schoolYear))) throw new Error(`Unexpected schoolYear for ${persona.portalUserId}.`);
    if (!Array.isArray(user.batches) || !user.batches.length) throw new Error(`Missing current batch for ${persona.portalUserId}.`);
    if (!Array.isArray(persona.coreCurricula) || !persona.coreCurricula.length) throw new Error(`Missing core curricula for ${persona.portalUserId}.`);
    if (!Array.isArray(persona.vrCurricula)) throw new Error(`Invalid VR curricula for ${persona.portalUserId}.`);
    if (persona.vrCurricula.length && user.vrEligible !== true) throw new Error(`VR curriculum assigned to non-VR persona ${persona.portalUserId}.`);

    let coreCount = 0;
    let vrCount = 0;
    for (const code of persona.coreCurricula) {
      const curriculum = catalogue?.curricula?.[code];
      if (!curriculum?.lessonIds) throw new Error(`Unknown curriculum ${code} for ${persona.portalUserId}.`);
      if (!batchForCurriculum(persona, code)) throw new Error(`No matching current batch for ${persona.portalUserId} / ${code}.`);
      coreCount += curriculum.lessonIds.length;
      if (persona.vrCurricula.includes(code)) vrCount += curriculum.lessonIds.length;
    }
    for (const code of persona.vrCurricula) {
      if (!persona.coreCurricula.includes(code)) throw new Error(`VR curriculum must also be core for ${persona.portalUserId}.`);
    }
    if (coreCount !== Number(persona.expectedCoreEntitlementCount)) throw new Error(`Core entitlement count mismatch for ${persona.portalUserId}.`);
    if (vrCount !== Number(persona.expectedVrEntitlementCount)) throw new Error(`VR entitlement count mismatch for ${persona.portalUserId}.`);
    entitlementRows += coreCount;
    vrRows += vrCount;
  }

  if (entitlementRows !== 447) throw new Error(`Expected 447 test entitlement rows; found ${entitlementRows}.`);
  if (vrRows !== 64) throw new Error(`Expected 64 VR-enabled test entitlement rows; found ${vrRows}.`);

  return { personas: personas.length, entitlementRows, vrRows };
}

export function buildPhase11TestSeed(catalogue, manifest) {
  const validation = validatePhase11TestPersonas(catalogue, manifest);
  const studentKvRows = [];
  const entitlements = [];

  for (const persona of manifest.personas) {
    studentKvRows.push({
      key: `user:${persona.portalUserIdNorm}`,
      value: JSON.stringify(persona.user)
    });
    for (const curriculumCode of persona.coreCurricula) {
      const batchCode = batchForCurriculum(persona, curriculumCode);
      const vrAccess = persona.vrCurricula.includes(curriculumCode) ? 1 : 0;
      for (const lessonId of catalogue.curricula[curriculumCode].lessonIds) {
        entitlements.push({
          portalUserIdNorm: persona.portalUserIdNorm,
          lessonId,
          coreAccess: 1,
          vrAccess,
          sourceBatchCode: batchCode
        });
      }
    }
  }

  const deletes = manifest.personas
    .map(persona => `DELETE FROM lesson_entitlements WHERE portal_user_id_norm = ${sql(persona.portalUserIdNorm)};`)
    .join('\n');
  const tuples = entitlements.map(row => `(${[
    sql(row.portalUserIdNorm),
    sql(row.lessonId),
    '1',
    String(row.vrAccess),
    sql('excel'),
    sql(TEST_TIMESTAMP),
    sql(TEST_TIMESTAMP),
    sql(row.sourceBatchCode),
    sql(TEST_DATE)
  ].join(',')})`);
  const insert = `INSERT INTO lesson_entitlements (portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date) VALUES\n${tuples.join(',\n')};`;

  return {
    validation,
    studentKvRows,
    entitlements,
    d1Sql: `${deletes}\n${insert}\n`
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalogue = loadPhase11Catalogue();
  const manifest = loadPhase11TestPersonas();
  const seed = buildPhase11TestSeed(catalogue, manifest);
  const outArg = process.argv.indexOf('--write-dir');
  if (outArg >= 0) {
    const outputDir = path.resolve(process.argv[outArg + 1]);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'phase11-test-students-kv-bulk.json'), JSON.stringify(seed.studentKvRows), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'phase11-test-entitlements.sql'), seed.d1Sql, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'phase11-test-seed-summary.json'), JSON.stringify(seed.validation, null, 2), 'utf8');
  }
  console.log(JSON.stringify(seed.validation, null, 2));
}
