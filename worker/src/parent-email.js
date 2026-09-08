const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const DEFAULT_FROM = 'sej@futureperfect.education';
const DEFAULT_FROM_NAME = 'Sejal Dalal';
const DEFAULT_CC = 'barkha@futureperfect.education';
const SIGNATURE_CID = 'fpt-email-signature-clean';
const SIGNATURE_FILENAME = 'fpt-email-signature.png';
const SIGNATURE_SOURCE_URL = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/assets/sej-email-signature-clean.png?v=20260908-inline';

let signatureBytesPromise = null;

function onlineMode(value) {
  return clean(value).toUpperCase().includes('O');
}

function completedStatus(value) {
  const status = norm(value);
  return status.includes('completed') && !/\bnot\s+completed\b/.test(status);
}

function emailTypeForItem(item) {
  const status = clean(item?.lessonStatus);
  if (completedStatus(status)) return 'COMPLETED';
  if (/\bslide\b/i.test(status)) return 'ONGOING';
  if (norm(status) === 'ready' && onlineMode(item?.batchKey)) return 'UPCOMING';
  return '';
}

function prelessonSheetsFromRemarks(value) {
  const remarks = norm(value).replace(/\s+/g, ' ');
  if (!remarks) return null;
  if (/\bno\s+pre\s*lesson\s+sheets?\b/.test(remarks)) return false;
  if (/\bpre\s*lesson\s+sheets?\b/.test(remarks)) return true;
  if (/\bvr\s+sheets?\b/.test(remarks)) return true;
  return null;
}

function validEmail(value) {
  const email = clean(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateParentEmailFields(item, env = null) {
  const emailType = clean(item?.emailType || emailTypeForItem(item));
  if (!emailType) return null;
  if (!clean(item?.name)) return ['EMAIL_STUDENT_NAME_REQUIRED', 'Name is required for the parent email.'];
  if (!clean(item?.parent)) return ['EMAIL_PARENT_NAME_REQUIRED', 'Parent is required for the parent email greeting.'];
  if (!validEmail(item?.parentEmail)) return ['EMAIL_ADDRESS_INVALID', 'Email must contain a valid parent email address.'];
  if (!clean(item?.subjectFromCsv)) return ['EMAIL_SUBJECT_REQUIRED', 'Subject is required for the parent email.'];
  if (!clean(item?.lessonLabel)) return ['EMAIL_LESSON_REQUIRED', 'Lesson is required for the parent email.'];
  if (!clean(item?.lessonDateDisplay)) return ['EMAIL_LESSON_DATE_REQUIRED', 'LessonDated is required for the parent email.'];
  if (emailType === 'UPCOMING' && prelessonSheetsFromRemarks(item?.remarks) === null) {
    return ['EMAIL_PRELESSON_REMARKS_REQUIRED', 'Remarks must say whether PreLesson Sheets are to be printed.'];
  }
  if (env && (!env.EMAIL || typeof env.EMAIL.send !== 'function')) {
    return ['EMAIL_SENDING_NOT_CONFIGURED', 'Cloudflare Email Sending is not configured on the Worker.'];
  }
  return null;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slideText(value) {
  const status = clean(value);
  const match = status.match(/\bslide\b\s*([0-9]+(?:\.[0-9]+)?[A-Za-z]?)/i);
  if (match) return `Slide ${match[1]}`;
  const rest = status.match(/\bslide\b.*$/i);
  if (!rest) return 'the marked slide';
  return rest[0].replace(/^slide\b/i, 'Slide');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function isPng(bytes) {
  return bytes.length >= 8 &&
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
    bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}

async function loadSignatureBytes(env = null) {
  const override = clean(env?.PARENT_EMAIL_SIGNATURE_BASE64);
  if (override) {
    const binary = atob(override);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  if (!signatureBytesPromise) {
    signatureBytesPromise = (async () => {
      const response = await fetch(SIGNATURE_SOURCE_URL, {
        headers: { Accept:'image/png' }
      });
      if (!response.ok) throw new Error(`Signature image request failed with HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 1000 || !isPng(bytes)) {
        throw new Error('Signature image response is not a valid PNG.');
      }
      return bytes;
    })().catch(error => {
      signatureBytesPromise = null;
      throw error;
    });
  }
  return signatureBytesPromise;
}

function utf8Base64(value) {
  return bytesToBase64(new TextEncoder().encode(String(value ?? '')));
}

function wrapBase64(value, width = 76) {
  const text = String(value || '');
  if (!text) return '';
  const lines = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\r\n');
}

function safeHeader(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function mimeBoundary(prefix) {
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${id}`;
}

function buildRawMime({ fromEmail, fromName, toEmail, ccEmail = '', subject, html, text, signatureBytes }) {
  const relatedBoundary = mimeBoundary('fpt_related');
  const alternativeBoundary = mimeBoundary('fpt_alt');
  const imageBase64 = wrapBase64(bytesToBase64(signatureBytes));
  const textBase64 = wrapBase64(utf8Base64(text));
  const htmlBase64 = wrapBase64(utf8Base64(html));
  const lines = [
    `From: ${safeHeader(fromName)} <${safeHeader(fromEmail)}>`,
    `To: ${safeHeader(toEmail)}`,
    ...(ccEmail ? [`Cc: Barkha <${safeHeader(ccEmail)}>`] : []),
    `Subject: ${safeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textBase64,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${alternativeBoundary}--`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: image/png; name="${SIGNATURE_FILENAME}"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${SIGNATURE_CID}>`,
    `X-Attachment-Id: ${SIGNATURE_CID}`,
    `Content-Disposition: inline; filename="${SIGNATURE_FILENAME}"`,
    '',
    imageBase64,
    '',
    `--${relatedBoundary}--`,
    ''
  ];
  return lines.join('\r\n');
}

async function createRawEmailMessage(env, fromEmail, envelopeTo, rawMime) {
  if (typeof env?.__EMAIL_MESSAGE_FACTORY === 'function') {
    return env.__EMAIL_MESSAGE_FACTORY(fromEmail, envelopeTo, rawMime);
  }
  const { EmailMessage } = await import('cloudflare:email');
  return new EmailMessage(fromEmail, envelopeTo, rawMime);
}

function htmlShell(content) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;color:#111111;">
${content}
<p style="margin:0 0 20px 0;">Warmly,</p>
<p style="margin:0 0 24px 0;">Sej</p>
<img src="cid:${SIGNATURE_CID}" width="600" alt="Sejal Dalal — Future Perfect Tuitions" style="display:block;width:600px;max-width:100%;height:auto;border:0;">
</div>`;
}

function buildUpcoming(item) {
  const name = escapeHtml(item.name);
  const parent = escapeHtml(item.parent);
  const subject = escapeHtml(item.subjectFromCsv);
  const lesson = escapeHtml(item.lessonLabel);
  const date = escapeHtml(item.lessonDateDisplay);
  const hasSheets = prelessonSheetsFromRemarks(item.remarks);
  const sheetsSentence = hasSheets
    ? 'For this session, there are PreLesson Sheets to be printed which have been shared on your portal.'
    : 'For this session, there are no PreLesson Sheets to be printed.';

  const subjectLine = `Upcoming Lesson for ${clean(item.name)} and the worksheets to be printed before the next session on ${clean(item.lessonDateDisplay)}.`;
  const html = htmlShell(
`<p style="margin:0 0 20px 0;">Hello ${parent},</p>
<p style="margin:0 0 20px 0;">This is to let you know that ${name} will start <strong>&quot;${lesson}&quot;</strong> during the ${subject} session on ${date}.</p>
<p style="margin:0 0 20px 0;"><strong><em>Sheets to be printed before the class:</em></strong> ${escapeHtml(sheetsSentence)}</p>`
  );
  const text =
`Hello ${clean(item.parent)},

This is to let you know that ${clean(item.name)} will start "${clean(item.lessonLabel)}" during the ${clean(item.subjectFromCsv)} session on ${clean(item.lessonDateDisplay)}.

Sheets to be printed before the class: ${sheetsSentence}

Warmly,

Sej

Sejal Dalal
Tutor
Future Perfect Tuitions
075 8339 1800
https://www.futureperfect.education/`;

  return { subject: subjectLine, html, text };
}

function buildCompleted(item) {
  const name = escapeHtml(item.name);
  const parent = escapeHtml(item.parent);
  const subject = escapeHtml(item.subjectFromCsv);
  const lesson = escapeHtml(item.lessonLabel);
  const date = escapeHtml(item.lessonDateDisplay);

  const subjectLine = `Completed Lesson: Update on ${clean(item.name)}'s Lesson and its homework, for the session on ${clean(item.lessonDateDisplay)}.`;
  const html = htmlShell(
`<p style="margin:0 0 20px 0;">Hello ${parent},</p>
<p style="margin:0 0 20px 0;">This is to let you know that ${name}'s class has studied <strong>&quot;${lesson}&quot;</strong> during the ${subject} session on ${date}.</p>
<p style="margin:0 0 20px 0;">We have completed the lesson. The homework has already been uploaded so ${name} should be able to complete it this week.</p>`
  );
  const text =
`Hello ${clean(item.parent)},

This is to let you know that ${clean(item.name)}'s class has studied "${clean(item.lessonLabel)}" during the ${clean(item.subjectFromCsv)} session on ${clean(item.lessonDateDisplay)}.

We have completed the lesson. The homework has already been uploaded so ${clean(item.name)} should be able to complete it this week.

Warmly,

Sej

Sejal Dalal
Tutor
Future Perfect Tuitions
075 8339 1800
https://www.futureperfect.education/`;

  return { subject: subjectLine, html, text };
}

function buildOngoing(item) {
  const name = escapeHtml(item.name);
  const parent = escapeHtml(item.parent);
  const subject = escapeHtml(item.subjectFromCsv);
  const lesson = escapeHtml(item.lessonLabel);
  const date = escapeHtml(item.lessonDateDisplay);
  const slide = escapeHtml(slideText(item.lessonStatus));

  const subjectLine = `Ongoing Lesson: Update on ${clean(item.name)}'s Lesson and its homework, for the session on ${clean(item.lessonDateDisplay)}.`;
  const html = htmlShell(
`<p style="margin:0 0 20px 0;">Hello ${parent},</p>
<p style="margin:0 0 20px 0;">This is to let you know that ${name}'s class has studied <strong>&quot;${lesson}&quot;</strong> during the ${subject} session on ${date}.</p>
<p style="margin:0 0 20px 0;">We have not yet finished the lesson and we will start from ${slide} next session. <strong style="color:#ff0000;">If there were any PreLesson Sheets given for this lesson, ${name} must have them handy for next lesson as well.</strong></p>
<p style="margin:0 0 20px 0;">We suggest that ${name} completes as much homework as possible. ${name} may not be able to finish the homework as the lesson is not completed yet.</p>
<p style="margin:0 0 20px 0;">It is very important to thoroughly revise the lesson (which also has been uploaded), as we may go into more advanced concepts next lesson.</p>`
  );
  const text =
`Hello ${clean(item.parent)},

This is to let you know that ${clean(item.name)}'s class has studied "${clean(item.lessonLabel)}" during the ${clean(item.subjectFromCsv)} session on ${clean(item.lessonDateDisplay)}.

We have not yet finished the lesson and we will start from ${slideText(item.lessonStatus)} next session. If there were any PreLesson Sheets given for this lesson, ${clean(item.name)} must have them handy for next lesson as well.

We suggest that ${clean(item.name)} completes as much homework as possible. ${clean(item.name)} may not be able to finish the homework as the lesson is not completed yet.

It is very important to thoroughly revise the lesson (which also has been uploaded), as we may go into more advanced concepts next lesson.

Warmly,

Sej

Sejal Dalal
Tutor
Future Perfect Tuitions
075 8339 1800
https://www.futureperfect.education/`;

  return { subject: subjectLine, html, text };
}

function buildParentEmail(item) {
  const emailType = clean(item?.emailType || emailTypeForItem(item));
  if (emailType === 'UPCOMING') return { emailType, ...buildUpcoming(item) };
  if (emailType === 'COMPLETED') return { emailType, ...buildCompleted(item) };
  if (emailType === 'ONGOING') return { emailType, ...buildOngoing(item) };
  return null;
}

async function sendParentEmail(env, item) {
  const validation = validateParentEmailFields(item, env);
  if (validation) return { ok:false, status:validation[0], message:validation[1] };

  const built = buildParentEmail(item);
  if (!built) return { ok:true, status:'NOT_REQUIRED', messageId:'' };

  const fromEmail = clean(env?.PARENT_EMAIL_FROM) || DEFAULT_FROM;
  const fromName = clean(env?.PARENT_EMAIL_FROM_NAME) || DEFAULT_FROM_NAME;
  const ccEmail = clean(env?.PARENT_EMAIL_CC) || DEFAULT_CC;
  const intendedTo = clean(item.parentEmail);
  const testTo = clean(env?.PARENT_EMAIL_TEST_TO);
  const deliveredTo = testTo || intendedTo;
  const testMode = Boolean(testTo);

  let signatureBytes = null;
  try {
    signatureBytes = await loadSignatureBytes(env);
  } catch (error) {
    return {
      ok:false,
      status:'EMAIL_SIGNATURE_LOAD_FAILED',
      message:clean(error?.message) || 'Could not load the parent email signature image.',
      testMode,
      deliveredTo,
      intendedTo,
      intendedCc:ccEmail
    };
  }

  const rawMime = buildRawMime({
    fromEmail,
    fromName,
    toEmail:deliveredTo,
    ccEmail:testMode ? '' : ccEmail,
    subject:built.subject,
    html:built.html,
    text:built.text,
    signatureBytes
  });
  const envelopeRecipients = testMode ? [deliveredTo] : [intendedTo, ccEmail];

  try {
    const messageIds = [];
    for (const envelopeTo of envelopeRecipients) {
      const message = await createRawEmailMessage(env, fromEmail, envelopeTo, rawMime);
      const response = await env.EMAIL.send(message);
      const id = clean(response?.messageId);
      if (id) messageIds.push(id);
    }
    return {
      ok:true,
      status:'SENT',
      messageId:messageIds[0] || '',
      messageIds,
      subject:built.subject,
      testMode,
      deliveredTo,
      intendedTo,
      intendedCc:ccEmail
    };
  } catch (error) {
    return {
      ok:false,
      status:clean(error?.code) || 'EMAIL_SEND_FAILED',
      message:clean(error?.message) || 'Cloudflare could not send the parent email.',
      testMode,
      deliveredTo,
      intendedTo,
      intendedCc:ccEmail
    };
  }
}

export {
  emailTypeForItem,
  prelessonSheetsFromRemarks,
  validateParentEmailFields,
  buildParentEmail,
  sendParentEmail,
  completedStatus,
  slideText,
  loadSignatureBytes,
  buildRawMime,
  SIGNATURE_CID,
  SIGNATURE_SOURCE_URL
};
