import { FPT_EMAIL_SIGNATURE_PNG_BASE64 } from './parent-email-signature.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const DEFAULT_FROM = 'sej@futureperfect.education';
const DEFAULT_FROM_NAME = 'Sejal Dalal';
const DEFAULT_CC = 'barkha@futureperfect.education';
const SIGNATURE_CID = 'fpt-email-signature';
const SIGNATURE_FILENAME = 'fpt-email-signature.png';

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

function htmlShell(content) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.45;color:#111111;">
${content}
<p style="margin:0 0 20px 0;">Warmly,</p>
<p style="margin:0 0 24px 0;">Sej</p>
<img src="cid:${SIGNATURE_CID}" width="700" alt="Sejal Dalal — Future Perfect Tuitions" style="display:block;width:700px;max-width:100%;height:auto;border:0;">
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

  try {
    const response = await env.EMAIL.send({
      from: { email:fromEmail, name:fromName },
      to: clean(item.parentEmail),
      cc: { email:ccEmail, name:'Barkha' },
      subject: built.subject,
      html: built.html,
      text: built.text,
      attachments: [{
        content:FPT_EMAIL_SIGNATURE_PNG_BASE64,
        filename:SIGNATURE_FILENAME,
        type:'image/png',
        disposition:'inline',
        contentId:SIGNATURE_CID
      }]
    });
    return {
      ok:true,
      status:'SENT',
      messageId:clean(response?.messageId),
      subject:built.subject
    };
  } catch (error) {
    return {
      ok:false,
      status:clean(error?.code) || 'EMAIL_SEND_FAILED',
      message:clean(error?.message) || 'Cloudflare could not send the parent email.'
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
  slideText
};
