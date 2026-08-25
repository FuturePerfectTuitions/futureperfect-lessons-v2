import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhase11Catalogue, validatePhase11Catalogue } from './phase11-catalogue.mjs';

const EXPECTED_NAVIGATION_SHA256 = 'd82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083';

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function navigationLesson(record) {
  const safe = {
    lessonId: record.lessonId,
    title: String(record.title || ''),
    active: record.active !== false,
    order: record.order
  };
  if (record.displayIds != null) safe.displayIds = record.displayIds;
  if (record.displayLessonIds != null) safe.displayLessonIds = record.displayLessonIds;
  if (record.presentation?.displayIds != null) {
    safe.presentation = { displayIds: record.presentation.displayIds };
  }
  return safe;
}

export function buildPhase11NavigationManifest(catalogue) {
  const validation = validatePhase11Catalogue(catalogue);
  const curricula = {};
  for (const code of Object.keys(catalogue.curricula).sort()) {
    const record = catalogue.curricula[code];
    curricula[code] = {
      curriculumCode: record.curriculumCode,
      lessonIds: record.lessonIds,
      schemaVersion: record.schemaVersion ?? 1
    };
  }

  const lessons = {};
  for (const lessonId of Object.keys(catalogue.lessons).sort()) {
    lessons[lessonId] = navigationLesson(catalogue.lessons[lessonId]);
  }

  const manifest = {
    catalogueSha256: validation.catalogueSha256,
    curricula,
    lessons
  };
  const json = JSON.stringify(manifest);
  const navigationSha256 = sha256(json);
  if (navigationSha256 !== EXPECTED_NAVIGATION_SHA256) {
    throw new Error(`Phase 11 navigation manifest hash mismatch: ${navigationSha256}`);
  }
  return { manifest, json, navigationSha256 };
}

export function writePhase11NavigationManifest(outputPath = path.join(repoRoot(), 'worker', 'src', 'phase11-navigation-manifest.generated.js')) {
  const catalogue = loadPhase11Catalogue(repoRoot());
  const { manifest, json, navigationSha256 } = buildPhase11NavigationManifest(catalogue);
  const source = [
    '// Generated from the immutable Phase 11 canonical catalogue.',
    `// Source catalogue SHA-256: ${manifest.catalogueSha256}`,
    `// Navigation manifest SHA-256: ${navigationSha256}`,
    '// Navigation-only metadata; full lesson/resource records remain in LESSONS_KV.',
    '',
    `const PHASE11_NAVIGATION_MANIFEST = ${json};`,
    '',
    'export { PHASE11_NAVIGATION_MANIFEST };',
    ''
  ].join('\n');
  fs.writeFileSync(outputPath, source, 'utf8');
  return {
    outputPath,
    catalogueSha256: manifest.catalogueSha256,
    navigationSha256,
    curricula: Object.keys(manifest.curricula).length,
    lessons: Object.keys(manifest.lessons).length,
    bytes: Buffer.byteLength(source)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(repoRoot(), 'worker', 'src', 'phase11-navigation-manifest.generated.js');
  console.log(JSON.stringify(writePhase11NavigationManifest(outputPath)));
}

export { EXPECTED_NAVIGATION_SHA256 };
