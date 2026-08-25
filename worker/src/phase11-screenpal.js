const ALLOWED_HOSTS = new Set([
  'screenpal.com',
  'www.screenpal.com',
  'go.screenpal.com'
]);

function safeScreenPalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeEmbedUrl(value) {
  const url = safeScreenPalUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'go.screenpal.com') return null;
    if (!parsed.pathname.startsWith('/player/')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function presentationForView(viewId) {
  const id = String(viewId || '').trim().toLowerCase();
  if (/^maths-level[123]$/.test(id)) return '11plus';
  if (/^english-year[45]-11plus$/.test(id)) return '11plus';
  return 'normal';
}

function isEnglishElevenPlusView(viewId) {
  return /^english-year[45]-11plus$/.test(String(viewId || '').trim().toLowerCase());
}

function isMathsElevenPlusView(viewId) {
  return /^maths-level[123]$/.test(String(viewId || '').trim().toLowerCase());
}

function coreVideo(record) {
  return record?.video || record?.core?.video || null;
}

function explicitQuiz(record) {
  const video = coreVideo(record);
  if (!video || typeof video !== 'object') return null;

  const quiz = video.quiz;
  const source = quiz && typeof quiz === 'object' ? quiz : {};
  const embedUrl = safeEmbedUrl(source.embedUrl || video.quizEmbedUrl);
  const shareUrl = safeScreenPalUrl(
    source.shareUrl || source.directUrl || source.url || video.quizShareUrl || video.quizDirectUrl
  );

  if (!embedUrl && !shareUrl) return null;

  return {
    mode: embedUrl ? 'embed' : 'link',
    url: embedUrl || shareUrl,
    embedUrl,
    shareUrl,
    displayName: String(source.displayName || source.name || video.quizDisplayName || 'ScreenPal Quiz').trim() || 'ScreenPal Quiz'
  };
}

function normalMainVideo(record) {
  const video = coreVideo(record);
  if (!video || typeof video !== 'object') return null;

  const embedUrl = safeEmbedUrl(video.embedUrl || video.playerUrl);
  if (!embedUrl) return null;

  return {
    embedUrl,
    contentUrl: safeScreenPalUrl(video.contentUrl),
    watchUrl: safeScreenPalUrl(video.watchUrl)
  };
}

function explicitMainVideo(record, viewId) {
  // English has one ordinary lesson video shared by normal and 11+ streams.
  // English does not use the ScreenPal interactive-quiz variant.
  if (isEnglishElevenPlusView(viewId)) return normalMainVideo(record);

  // Maths 11+ uses the interactive quiz in the Lesson Video slot when one is
  // explicitly available. If no quiz exists, fall back to the ordinary lesson
  // video rather than hiding the video altogether.
  if (isMathsElevenPlusView(viewId)) {
    const quiz = explicitQuiz(record);
    if (quiz?.embedUrl) {
      return {
        embedUrl: quiz.embedUrl,
        contentUrl: quiz.shareUrl,
        watchUrl: quiz.shareUrl
      };
    }
  }

  return normalMainVideo(record);
}

function rawVr(record) {
  const vr = record?.vr;
  return vr && typeof vr === 'object' ? vr : null;
}

function explicitVrVideo(record, kind) {
  const vr = rawVr(record);
  if (!vr) return null;

  const source = kind === 'vrprevideo'
    ? vr.preLessonVideo
    : (kind === 'vrhomeworkvideo' ? (vr.homeworkVideo || vr.homeworkSolutionVideo) : null);

  if (!source || typeof source !== 'object') return null;
  const embedUrl = safeEmbedUrl(source.embedUrl || source.playerUrl);
  if (!embedUrl) return null;

  return {
    embedUrl,
    contentUrl: safeScreenPalUrl(source.contentUrl),
    watchUrl: safeScreenPalUrl(source.watchUrl)
  };
}

export {
  safeScreenPalUrl,
  safeEmbedUrl,
  presentationForView,
  explicitMainVideo,
  explicitVrVideo,
  explicitQuiz
};