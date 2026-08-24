import assert from 'node:assert/strict';
import {
  safeScreenPalUrl,
  safeEmbedUrl,
  explicitMainVideo,
  explicitVrVideo,
  explicitQuiz
} from '../worker/src/phase11-screenpal.js';

const VIDEO_ID = 'cOj3bFnvPmr';
const VIDEO_EMBED = 'https://go.screenpal.com/player/cOj3bFnvPmr?ff=1&ahc=1&dcc=1&tl=1&bg=transparent';
const VIDEO_CONTENT = 'https://screenpal.com/content/video/cOj3bFnvPmr';
const VIDEO_WATCH = 'https://go.screenpal.com/watch/cOj3bFnvPmr';
const QUIZ_ID = 'cOivb222Z';
const QUIZ_DIRECT = 'https://screenpal.com/content/quizzes/cOivb222Z';
const QUIZ_EMBED = 'https://go.screenpal.com/player/cO1b1nnupar?quiz_id=cOivb222Z&width=100%25&height=100%25&ff=1&title=0&dcc=0&bg=transparent&embedded=1';

assert.equal(safeScreenPalUrl(VIDEO_CONTENT), VIDEO_CONTENT);
assert.equal(safeEmbedUrl(VIDEO_EMBED), VIDEO_EMBED);
assert.equal(safeScreenPalUrl('https://example.com/player/x'), null);
assert.equal(safeScreenPalUrl('http://go.screenpal.com/player/x'), null);

assert.equal(explicitMainVideo({ core: { video: { screenpal: VIDEO_ID } } }, 'maths-year5'), null);
assert.equal(explicitQuiz({ core: { video: { quiz: QUIZ_ID } } }), null);
assert.equal(explicitVrVideo({ vr: { preLessonVideo: { screenpal: VIDEO_ID } } }, 'vrprevideo'), null);

const mainRecord = {
  core: {
    video: {
      screenpal: VIDEO_ID,
      contentUrl: VIDEO_CONTENT,
      watchUrl: VIDEO_WATCH,
      embedUrl: VIDEO_EMBED
    }
  }
};
assert.deepEqual(explicitMainVideo(mainRecord, 'maths-year5'), {
  embedUrl: VIDEO_EMBED,
  contentUrl: VIDEO_CONTENT,
  watchUrl: VIDEO_WATCH
});

// An 11+ presentation must never fall back to the normal video or to a legacy
// elevenPlus override. Without an explicit quiz embed there is no 11+ lesson video.
const overrideEmbed = 'https://go.screenpal.com/player/cOverride11?ff=1&ahc=1&dcc=1&tl=1&bg=transparent';
const overrideRecord = {
  core: {
    video: {
      screenpal: VIDEO_ID,
      embedUrl: VIDEO_EMBED,
      elevenPlus: { screenpal: 'cOverride11', embedUrl: overrideEmbed }
    }
  }
};
assert.equal(explicitMainVideo(overrideRecord, 'maths-year5').embedUrl, VIDEO_EMBED);
assert.equal(explicitMainVideo(overrideRecord, 'maths-level2'), null);

const quizRecord = {
  core: {
    video: {
      screenpal: VIDEO_ID,
      embedUrl: VIDEO_EMBED,
      contentUrl: VIDEO_CONTENT,
      watchUrl: VIDEO_WATCH,
      quiz: {
        id: QUIZ_ID,
        shareUrl: QUIZ_DIRECT,
        embedUrl: QUIZ_EMBED,
        displayName: 'ScreenPal Quiz'
      }
    }
  }
};
const quiz = explicitQuiz(quizRecord);
assert.equal(quiz.mode, 'embed');
assert.equal(quiz.url, QUIZ_EMBED);
assert.equal(quiz.shareUrl, QUIZ_DIRECT);

// Normal and 11+ students see the same frontend concept, Lesson Video, but the
// resolved ScreenPal embed is presentation-specific.
assert.equal(explicitMainVideo(quizRecord, 'maths-year5').embedUrl, VIDEO_EMBED);
assert.equal(explicitMainVideo(quizRecord, 'maths-level2').embedUrl, QUIZ_EMBED);
assert.ok(!explicitMainVideo(quizRecord, 'maths-year5').embedUrl.includes('quiz_id='));
assert.ok(explicitMainVideo(quizRecord, 'maths-level2').embedUrl.includes('quiz_id='));

const directOnlyQuiz = explicitQuiz({ video: { quiz: { id: QUIZ_ID, shareUrl: QUIZ_DIRECT } } });
assert.equal(directOnlyQuiz.mode, 'link');
assert.equal(directOnlyQuiz.url, QUIZ_DIRECT);
assert.equal(explicitMainVideo({ video: { embedUrl: VIDEO_EMBED, quiz: { id: QUIZ_ID, shareUrl: QUIZ_DIRECT } } }, 'maths-level2'), null);

const vrRecord = {
  vr: {
    preLessonVideo: { screenpal: VIDEO_ID, embedUrl: VIDEO_EMBED },
    homeworkVideo: {
      screenpal: 'cHomework',
      embedUrl: 'https://go.screenpal.com/player/cHomework?ff=1&ahc=1&dcc=1&tl=1&bg=transparent'
    }
  }
};
assert.equal(explicitVrVideo(vrRecord, 'vrprevideo').embedUrl, VIDEO_EMBED);
assert.equal(
  explicitVrVideo(vrRecord, 'vrhomeworkvideo').embedUrl,
  'https://go.screenpal.com/player/cHomework?ff=1&ahc=1&dcc=1&tl=1&bg=transparent'
);

console.log('Phase 11 ScreenPal explicit-URL and lesson-video variant verification: PASS');