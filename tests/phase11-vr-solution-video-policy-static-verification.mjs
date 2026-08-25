import fs from 'node:fs';

const efficient = fs.readFileSync('worker/src/index-phase11-efficient.js', 'utf8');
const phase9 = fs.readFileSync('worker/src/index-phase9.js', 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText(efficient, 'async function suppressVrSolutionVideoResponse', 'central VR solution-video policy');
requireText(efficient, 'body.lesson.vr.homeworkVideo = null;', 'lesson-detail homeworkVideo suppression');
requireText(efficient, "resourceKind(videoMatch[1]) === 'vrhomeworkvideo'", 'direct VR homework-video route suppression');
requireText(efficient, "JSON.stringify({ error: 'RESOURCE_NOT_FOUND' })", 'direct-route not-found response');
requireText(efficient, 'const presentedResponse = await suppressVrSolutionVideoResponse', 'policy application to final response');

// Owner explicitly removed only VR homework solution videos. VR PreLesson teaching videos remain supported.
requireText(phase9, 'preLessonVideo: normaliseVideo(vr.preLessonVideo)', 'VR PreLesson video source support');
requireText(phase9, "openVideo('VR PreLesson Video'", 'VR PreLesson video presentation support');

console.log('Phase 11 VR homework solution-video suppression static verification: PASS');
