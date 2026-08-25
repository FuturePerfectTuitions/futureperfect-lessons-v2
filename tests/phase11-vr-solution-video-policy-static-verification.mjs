import fs from 'node:fs';

const efficient = fs.readFileSync('worker/src/index-phase11-efficient.js', 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText(efficient, 'async function suppressVrVideoResponse', 'central VR video policy');
requireText(efficient, 'body.lesson.vr.preLessonVideo = null;', 'lesson-detail preLessonVideo suppression');
requireText(efficient, 'body.lesson.vr.homeworkVideo = null;', 'lesson-detail homeworkVideo suppression');
requireText(efficient, "kind === 'vrprevideo' || kind === 'vrhomeworkvideo'", 'direct VR video route suppression');
requireText(efficient, "JSON.stringify({ error: 'RESOURCE_NOT_FOUND' })", 'direct-route not-found response');
requireText(efficient, 'const presentedResponse = await suppressVrVideoResponse', 'policy application to final response');

console.log('Phase 11 all-VR-video suppression static verification: PASS');
