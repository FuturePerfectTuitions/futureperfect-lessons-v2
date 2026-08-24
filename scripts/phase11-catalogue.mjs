import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const EXPECTED = Object.freeze({
  phase: 11,
  curricula: 11,
  lessons: 369,
  kvKeys: 380,
  r2Keys: 1669,
  videos: 123,
  pendingVideos: 246,
  quizzes: 79,
  vrLessons: 66,
  elevenPlusOther: 9,
  combinedBase64Sha256: 'eaab7168caae92ca70a4bc245a56faf35695046787699a10e376f5f16bc6c959',
  catalogueSha256: '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663',
  kvBulkSha256: 'e3a07b4fcac37604bcb321a66f3049051449bb6f3c94fb8a7e2c8a70368ee5b9'
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function safeScreenPalUrl(value, kind) {
  if (typeof value !== 'string' || !value.trim()) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (!['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(url.hostname.toLowerCase())) return false;
  if (kind === 'embed') return url.hostname.toLowerCase() === 'go.screenpal.com' && url.pathname.startsWith('/player/');
  if (kind === 'video-content') return ['screenpal.com', 'www.screenpal.com'].includes(url.hostname.toLowerCase()) && url.pathname.startsWith('/content/video/');
  if (kind === 'video-watch') return url.hostname.toLowerCase() === 'go.screenpal.com' && url.pathname.startsWith('/watch/');
  if (kind === 'quiz-share') return ['screenpal.com', 'www.screenpal.com'].includes(url.hostname.toLowerCase()) && url.pathname.startsWith('/content/quizzes/');
  return true;
}

function collectR2Keys(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value.r2Key === 'string' && value.r2Key.trim()) out.push(value.r2Key.trim());
  if (Array.isArray(value)) {
    for (const item of value) collectR2Keys(item, out);
    return out;
  }
  for (const item of Object.values(value)) collectR2Keys(item, out);
  return out;
}

export function loadPhase11Catalogue(root = repoRoot()) {
  const base = path.join(root, 'docs', 'data', 'phase11', 'catalogue_payload');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'catalogue.parts.json'), 'utf8'));
  if (manifest.phase !== EXPECTED.phase || manifest.encoding !== 'gzip+base64' || manifest.parts !== 10) {
    throw new Error('Unexpected Phase 11 catalogue payload manifest.');
  }
  if (!Array.isArray(manifest.partFiles) || manifest.partFiles.length !== manifest.parts) {
    throw new Error('Phase 11 catalogue payload part list is invalid.');
  }
  const combined = manifest.partFiles
    .map(name => fs.readFileSync(path.join(base, name), 'utf8').replace(/\s+/g, ''))
    .join('');
  if (sha256(combined) !== EXPECTED.combinedBase64Sha256 || manifest.combinedBase64Sha256 !== EXPECTED.combinedBase64Sha256) {
    throw new Error('Phase 11 combined catalogue payload hash mismatch.');
  }
  const decoded = zlib.gunzipSync(Buffer.from(combined, 'base64'));
  if (sha256(decoded) !== EXPECTED.catalogueSha256 || manifest.decodedJsonSha256 !== EXPECTED.catalogueSha256) {
    throw new Error('Phase 11 decoded catalogue hash mismatch.');
  }
  return JSON.parse(decoded.toString('utf8'));
}

export function buildPhase11KvBulk(catalogue) {
  const rows = [];
  for (const lessonId of Object.keys(catalogue.lessons || {}).sort()) {
    rows.push({ key: `lesson:${lessonId}`, value: JSON.stringify(catalogue.lessons[lessonId]) });
  }
  for (const curriculumCode of Object.keys(catalogue.curricula || {}).sort()) {
    rows.push({ key: `curriculum:${curriculumCode}`, value: JSON.stringify(catalogue.curricula[curriculumCode]) });
  }
  return rows;
}

export function validatePhase11Catalogue(catalogue) {
  const curricula = catalogue?.curricula || {};
  const lessons = catalogue?.lessons || {};
  const curriculumCodes = Object.keys(curricula);
  const lessonIds = Object.keys(lessons);
  if (catalogue?.phase !== EXPECTED.phase) throw new Error('Catalogue phase is not 11.');
  if (catalogue?.catalogueStatus?.state !== 'phase11_apply_ready') throw new Error('Catalogue is not apply-ready.');
  if (curriculumCodes.length !== EXPECTED.curricula) throw new Error(`Expected ${EXPECTED.curricula} curricula.`);
  if (lessonIds.length !== EXPECTED.lessons) throw new Error(`Expected ${EXPECTED.lessons} lessons.`);

  const curriculumLessonIds = [];
  for (const code of curriculumCodes) {
    const record = curricula[code];
    if (record?.curriculumCode !== code || !Array.isArray(record?.lessonIds)) throw new Error(`Invalid curriculum ${code}.`);
    if (new Set(record.lessonIds).size !== record.lessonIds.length) throw new Error(`Duplicate lesson in curriculum ${code}.`);
    for (const lessonId of record.lessonIds) {
      if (!lessons[lessonId]) throw new Error(`Curriculum ${code} references missing lesson ${lessonId}.`);
      curriculumLessonIds.push(lessonId);
    }
  }
  if (curriculumLessonIds.length !== EXPECTED.lessons || new Set(curriculumLessonIds).size !== EXPECTED.lessons) {
    throw new Error('Every canonical lesson must occur in exactly one canonical curriculum.');
  }

  let videos = 0;
  let pendingVideos = 0;
  let quizzes = 0;
  let vrLessons = 0;
  let elevenPlusOther = 0;
  for (const lessonId of lessonIds) {
    const lesson = lessons[lessonId];
    if (lesson?.lessonId !== lessonId || lesson?.active !== true) throw new Error(`Invalid lesson identity/state for ${lessonId}.`);
    if (!Number.isInteger(lesson?.order) || lesson.order < 1 || !String(lesson?.title || '').trim()) throw new Error(`Invalid lesson metadata for ${lessonId}.`);
    if (!lesson?.displayIds || typeof lesson.displayIds !== 'object') throw new Error(`Missing displayIds for ${lessonId}.`);

    const video = lesson?.core?.video;
    if (video == null) {
      pendingVideos += 1;
      if (lesson?.contentStatus?.mainVideo !== 'in_production' || lesson?.contentStatus?.ownerConfirmedPending !== true) {
        throw new Error(`Null video is not owner-confirmed pending for ${lessonId}.`);
      }
    } else {
      videos += 1;
      if (!safeScreenPalUrl(video.embedUrl, 'embed')) throw new Error(`Unsafe/missing video embed URL for ${lessonId}.`);
      if (!safeScreenPalUrl(video.contentUrl, 'video-content')) throw new Error(`Unsafe/missing video content URL for ${lessonId}.`);
      if (!safeScreenPalUrl(video.watchUrl, 'video-watch')) throw new Error(`Unsafe/missing video watch URL for ${lessonId}.`);
      if (video.quiz) {
        quizzes += 1;
        if (!String(video.quiz.id || '').trim()) throw new Error(`Missing quiz ID for ${lessonId}.`);
        if (!safeScreenPalUrl(video.quiz.shareUrl, 'quiz-share') || !safeScreenPalUrl(video.quiz.embedUrl, 'embed')) {
          throw new Error(`Unsafe/missing explicit quiz URLs for ${lessonId}.`);
        }
        const quizUrl = new URL(video.quiz.embedUrl);
        if (!quizUrl.searchParams.get('quiz_id')) throw new Error(`Quiz embed lacks quiz_id for ${lessonId}.`);
      }
    }
    if (lesson?.vr) vrLessons += 1;
    elevenPlusOther += Array.isArray(lesson?.phase11OtherResources?.elevenPlus) ? lesson.phase11OtherResources.elevenPlus.length : 0;
  }

  if (videos !== EXPECTED.videos || pendingVideos !== EXPECTED.pendingVideos || quizzes !== EXPECTED.quizzes) {
    throw new Error(`ScreenPal counts mismatch: videos=${videos}, pending=${pendingVideos}, quizzes=${quizzes}.`);
  }
  if (vrLessons !== EXPECTED.vrLessons) throw new Error(`Expected ${EXPECTED.vrLessons} VR lessons; found ${vrLessons}.`);
  if (elevenPlusOther !== EXPECTED.elevenPlusOther) throw new Error(`Expected ${EXPECTED.elevenPlusOther} 11+ other resources; found ${elevenPlusOther}.`);

  const r2Keys = collectR2Keys(catalogue);
  if (r2Keys.length !== EXPECTED.r2Keys || new Set(r2Keys).size !== EXPECTED.r2Keys) {
    throw new Error(`R2 reference count mismatch: total=${r2Keys.length}, unique=${new Set(r2Keys).size}.`);
  }
  for (const key of r2Keys) {
    if (!/^(maths|english)\//.test(key) || key.includes('\\')) throw new Error(`Unsafe R2 key: ${key}`);
  }

  const bulk = buildPhase11KvBulk(catalogue);
  if (bulk.length !== EXPECTED.kvKeys) throw new Error(`Expected ${EXPECTED.kvKeys} KV writes; found ${bulk.length}.`);
  const bulkText = JSON.stringify(bulk);
  if (sha256(bulkText) !== EXPECTED.kvBulkSha256) throw new Error('Generated KV bulk hash mismatch.');

  return {
    lessons: lessonIds.length,
    curricula: curriculumCodes.length,
    kvKeys: bulk.length,
    r2Keys: r2Keys.length,
    videos,
    pendingVideos,
    quizzes,
    vrLessons,
    elevenPlusOther,
    catalogueSha256: EXPECTED.catalogueSha256,
    kvBulkSha256: EXPECTED.kvBulkSha256
  };
}

export { EXPECTED };
