const clean = value => String(value ?? '').trim();
const ALLOWED_HOSTS = new Set(['screenpal.com', 'www.screenpal.com', 'go.screenpal.com']);

function safeScreenPalUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function safeEmbedUrl(value) {
  const url = safeScreenPalUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase() === 'go.screenpal.com' && parsed.pathname.startsWith('/player/') ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function coreVideo(record) {
  return record?.video && typeof record.video === 'object'
    ? record.video
    : (record?.core?.video && typeof record.core.video === 'object' ? record.core.video : null);
}

function normalVideo(record) {
  const video = coreVideo(record);
  if (!video) return null;
  const targetUrl = safeEmbedUrl(video.embedUrl || video.playerUrl);
  return targetUrl ? { displayName: clean(video.displayName || video.name || 'Lesson Video') || 'Lesson Video', targetUrl } : null;
}

function elevenPlusVideo(record) {
  const video = coreVideo(record);
  if (!video) return null;
  const source = video.quiz && typeof video.quiz === 'object' ? video.quiz : {};
  const targetUrl = safeEmbedUrl(source.embedUrl || video.quizEmbedUrl);
  if (targetUrl) return { displayName: clean(source.displayName || source.name || video.quizDisplayName || 'Lesson Video') || 'Lesson Video', targetUrl };
  return normalVideo(record);
}

function compileVideoVariants(record) {
  const normal = normalVideo(record);
  const elevenPlus = elevenPlusVideo(record);
  if (!normal && !elevenPlus) return null;
  return { normal: normal || elevenPlus, elevenPlus: elevenPlus || normal };
}

function videoForView(videoVariants, viewId) {
  if (!videoVariants || typeof videoVariants !== 'object') return null;
  const id = clean(viewId).toLowerCase();
  return /^maths-level[123]$/.test(id)
    ? (videoVariants.elevenPlus || videoVariants.normal || null)
    : (videoVariants.normal || null);
}

export { compileVideoVariants, safeEmbedUrl, safeScreenPalUrl, videoForView };
