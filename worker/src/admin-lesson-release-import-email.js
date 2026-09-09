import { handleAdminLessonReleaseImport as handleBaseImport } from './admin-lesson-release-import.js';
import {
  emailTypeForItem,
  validateParentEmailFields,
  sendParentEmail,
  completedStatus
} from './parent-email.js';

const PREVIEW_PATH = '/api/v1/admin/lesson-releases/preview';
const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';
const EMAIL_DELIVERY_PREFIX = 'admin-email-delivery:v1:';
const PORTAL_ACTIONS = new Set([
  'GRANT_FULL', 'GRANT_PRELESSON', 'UPGRADE_TO_FULL', 'ALREADY_FULL', 'ALREADY_PRELESSON'
]);

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function rowValue(row, name) {
  if (!row || typeof row !== 'object') return '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(row)) {
    if (clean(key).toLowerCase() === wanted) return clean(value);
  }
  return '';
}

function setRowValue(row, name, value) {
  const result = { ...(row || {}) };
  const wanted = name.toLowerCase();
  for (const key of Object.keys(result)) {
    if (clean(key).toLowerCase() === wanted) {
      result[key] = value;
      return result;
    }
  }
  result[name] = value;
  return result;
}

function normalYearFromCsv(value) {
  const text = clean(value);
  if (/11\s*\+/i.test(text)) return null;
  const match = text.match(/\byear\s*([456])\b/i);
  return match ? Number(match[1]) : null;
}

function normaliseLessonLabelForYear(yearValue, lessonValue) {
  const raw = clean(lessonValue);
  const year = normalYearFromCsv(yearValue);
  if (!year) return raw;
  return raw.replace(/^L[1-3](?=T\d+)/i, `Y${year}`);
}

function normaliseCsvInputRow(row) {
  const year = rowValue(row, 'Year');
  const lesson = rowValue(row, 'Lesson');
  let result = setRowValue(row, 'Lesson', normaliseLessonLabelForYear(year, lesson));
  const lessonStatus = rowValue(result, 'LessonStatus');
  if (completedStatus(lessonStatus)) result = setRowValue(result, 'LessonStatus', 'Completed');
  return result;
}

function emailItemFromRow(row, index = 0) {
  const normalizedRow = normaliseCsvInputRow(row);
  const item = {
    index,
    portalUserId: rowValue(normalizedRow, 'Student'),
    portalUserIdNorm: norm(rowValue(normalizedRow, 'Student')),
    batchKey: rowValue(normalizedRow, 'Mode'),
    year: rowValue(normalizedRow, 'Year'),
    name: rowValue(normalizedRow, 'Name'),
    subjectFromCsv: rowValue(normalizedRow, 'Subject'),
    lessonLabel: rowValue(normalizedRow, 'Lesson'),
    lessonDateDisplay: rowValue(normalizedRow, 'LessonDated'),
    lessonStatus: rowValue(normalizedRow, 'LessonStatus'),
    remarks: rowValue(normalizedRow, 'Remarks'),
    parent: rowValue(normalizedRow, 'Parent'),
    parentEmail: rowValue(normalizedRow, 'Email')
  };
  item.emailType = emailTypeForItem(item);
  return item;
}

async function readJson(request) {
  try { return await request.clone().json(); } catch { return null; }
}

function requestWithJson(request, body) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

function responseLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status:response.status, headers });
}

function decoratePreview(body, rows, env) {
  if (!body?.ok || !Array.isArray(body.results)) return body;
  const items = rows.map(emailItemFromRow);
  const results = body.results.map((result, position) => {
    const index = Number.isInteger(result?.index) ? result.index : position;
    const item = items[index] || items[position] || emailItemFromRow(rows[position] || {}, position);
    const emailType = item.emailType;
    const decorated = {
      ...result,
      lessonLabel:item.lessonLabel || result.lessonLabel,
      parent:item.parent,
      parentEmail:item.parentEmail,
      emailType,
      emailAction:emailType ? `SEND_${emailType}` : 'NO_EMAIL'
    };
    const error = validateParentEmailFields(item, env);
    if (error) {
      return { ...decorated, ok:false, action:error[0], message:error[1] };
    }
    return decorated;
  });

  return {
    ...body,
    results,
    summary:{
      ...(body.summary || {}),
      total:results.length,
      releasable:results.filter(r => r.ok && PORTAL_ACTIONS.has(r.action)).length,
      emailEligible:results.filter(r => r.ok && r.emailType && r.action !== 'SKIP_DUPLICATE').length,
      skipped:results.filter(r => r.action === 'NO_RELEASE' || r.action === 'SKIP_DUPLICATE').length,
      errors:results.filter(r => !r.ok).length
    }
  };
}

function inputLessonToken(value) {
  return clean(value).split(/\s+/)[0].toLowerCase();
}

function portalResultKey(result) {
  return `${norm(result?.portalUserId)}|${norm(result?.inputLessonId || result?.lessonId)}`;
}

function emailInputKey(item) {
  return `${item.portalUserIdNorm}|${inputLessonToken(item.lessonLabel)}`;
}

async function sha256Hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function emailDeliveryIdentity(item) {
  return JSON.stringify([
    item.portalUserIdNorm,
    inputLessonToken(item.lessonLabel),
    norm(item.emailType),
    norm(item.lessonDateDisplay),
    norm(item.lessonStatus),
    norm(item.parentEmail)
  ]);
}

async function emailDeliveryKey(item) {
  return `${EMAIL_DELIVERY_PREFIX}${await sha256Hex(emailDeliveryIdentity(item))}`;
}

async function previousEmailDelivery(env, item) {
  if (!env?.STUDENTS_KV?.get) throw new Error('EMAIL_IDEMPOTENCY_NOT_CONFIGURED');
  return env.STUDENTS_KV.get(await emailDeliveryKey(item), { type:'json' });
}

async function rememberEmailDelivery(env, item, sent) {
  if (!env?.STUDENTS_KV?.put) throw new Error('EMAIL_IDEMPOTENCY_NOT_CONFIGURED');
  const key = await emailDeliveryKey(item);
  await env.STUDENTS_KV.put(key, JSON.stringify({
    status:'SENT',
    sentAt:new Date().toISOString(),
    portalUserId:item.portalUserId,
    lesson:inputLessonToken(item.lessonLabel),
    emailType:item.emailType,
    parentEmail:item.parentEmail,
    messageId:clean(sent?.messageId)
  }));
}

async function sendEmailsAfterConfirm(env, rows, portalBody) {
  const items = rows.map(emailItemFromRow);
  const portalFailures = new Set(
    (Array.isArray(portalBody?.results) ? portalBody.results : [])
      .filter(result => result?.ok === false)
      .map(portalResultKey)
  );
  const emailResults = [];

  for (const item of items) {
    if (!item.emailType) continue;
    const validation = validateParentEmailFields(item, env);
    if (validation) {
      emailResults.push({
        index:item.index,
        portalUserId:item.portalUserId,
        emailType:item.emailType,
        ok:false,
        status:validation[0],
        message:validation[1]
      });
      continue;
    }

    if (portalFailures.has(emailInputKey(item))) {
      emailResults.push({
        index:item.index,
        portalUserId:item.portalUserId,
        emailType:item.emailType,
        ok:false,
        status:'SKIPPED_PORTAL_FAILURE',
        message:'Parent email was not sent because the Portal action failed.'
      });
      continue;
    }

    let previous;
    try {
      previous = await previousEmailDelivery(env, item);
    } catch (error) {
      emailResults.push({
        index:item.index,
        portalUserId:item.portalUserId,
        parent:item.parent,
        parentEmail:item.parentEmail,
        emailType:item.emailType,
        ok:false,
        status:'IDEMPOTENCY_CHECK_FAILED',
        message:`Duplicate-email safety check failed: ${error.message}`
      });
      continue;
    }

    if (previous?.status === 'SENT') {
      emailResults.push({
        index:item.index,
        portalUserId:item.portalUserId,
        parent:item.parent,
        parentEmail:item.parentEmail,
        emailType:item.emailType,
        ok:true,
        status:'ALREADY_SENT',
        messageId:clean(previous.messageId),
        message:'This parent email was already sent for the same student, lesson, session and email type. Duplicate send skipped.'
      });
      continue;
    }

    const sent = await sendParentEmail(env, item);
    if (sent.status === 'SENT') {
      try {
        await rememberEmailDelivery(env, item, sent);
      } catch (error) {
        emailResults.push({
          index:item.index,
          portalUserId:item.portalUserId,
          parent:item.parent,
          parentEmail:item.parentEmail,
          emailType:item.emailType,
          ...sent,
          ok:false,
          status:'SENT_UNTRACKED',
          message:`Email was sent, but duplicate-send tracking could not be saved: ${error.message}`
        });
        continue;
      }
    }

    emailResults.push({
      index:item.index,
      portalUserId:item.portalUserId,
      parent:item.parent,
      parentEmail:item.parentEmail,
      emailType:item.emailType,
      ...sent
    });
  }

  const emailsSent = emailResults.filter(result => result.status === 'SENT').length;
  const emailsAlreadySent = emailResults.filter(result => result.status === 'ALREADY_SENT').length;
  const emailsFailed = emailResults.length - emailsSent - emailsAlreadySent;
  return {
    ...portalBody,
    emailResults,
    summary:{
      ...(portalBody?.summary || {}),
      emailsEligible:emailResults.length,
      emailsSent,
      emailsAlreadySent,
      emailsFailed
    }
  };
}

export async function handleAdminLessonReleaseImport(request, env) {
  const url = new URL(request.url);
  if (![PREVIEW_PATH, CONFIRM_PATH].includes(url.pathname) || request.method !== 'POST') {
    return handleBaseImport(request, env);
  }

  const body = await readJson(request);
  if (!Array.isArray(body?.rows)) return handleBaseImport(request, env);

  const normalizedRows = body.rows.map(normaliseCsvInputRow);
  const normalizedRequest = requestWithJson(request, { ...body, rows:normalizedRows });
  const baseResponse = await handleBaseImport(normalizedRequest, env);
  const baseBody = await baseResponse.clone().json().catch(() => null);
  if (!baseBody) return baseResponse;

  if (url.pathname === PREVIEW_PATH) {
    return responseLike(baseResponse, decoratePreview(baseBody, normalizedRows, env));
  }

  if (!baseResponse.ok || baseBody.ok !== true) return baseResponse;
  return responseLike(baseResponse, await sendEmailsAfterConfirm(env, normalizedRows, baseBody));
}

export {
  normalYearFromCsv,
  normaliseLessonLabelForYear,
  normaliseCsvInputRow,
  emailItemFromRow,
  decoratePreview,
  emailDeliveryIdentity,
  emailDeliveryKey,
  sendEmailsAfterConfirm
};
