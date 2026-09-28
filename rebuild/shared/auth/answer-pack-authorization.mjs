import { CAPABILITY_MAX_AGE_SECONDS, issueCapability } from './auth-core.mjs';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} callback is required`);
  return value;
}

function answerRequest(input) {
  const value = input && typeof input === 'object' ? input : {};
  const password = String(value.password ?? '');
  if (!password) throw new TypeError('Answer Pack password is required for every open');
  return {
    viewId: String(value.viewId ?? '').trim(),
    lessonId: String(value.lessonId ?? '').trim(),
    resourceId: String(value.resourceId ?? '').trim(),
    accessVersion: value.accessVersion ?? null,
    password
  };
}

/**
 * Authorises exactly one Answer Pack open.
 *
 * The caller owns the live password/rate-limit stores. This function intentionally
 * does not cache the password or rate state. It calls the supplied live adapters on
 * every open, then issues a short-lived answer-view capability only after success.
 */
export async function authorizeAnswerPackOpen({
  secret,
  session,
  request,
  checkRateLimit,
  validateCurrentPassword,
  recordFailedAttempt,
  clearFailedAttempts = async () => {},
  ttlSeconds = CAPABILITY_MAX_AGE_SECONDS,
  now = Date.now()
}) {
  const input = answerRequest(request);
  const check = requiredFunction(checkRateLimit, 'checkRateLimit');
  const validate = requiredFunction(validateCurrentPassword, 'validateCurrentPassword');
  const recordFailure = requiredFunction(recordFailedAttempt, 'recordFailedAttempt');
  const clearFailures = requiredFunction(clearFailedAttempts, 'clearFailedAttempts');

  const context = {
    userId: session?.sub,
    sessionId: session?.sid,
    viewId: input.viewId,
    lessonId: input.lessonId,
    resourceId: input.resourceId,
    now
  };

  const limit = await check(context);
  if (!limit?.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'answer_password_rate_limited',
      retryAfterSeconds: Number.isFinite(Number(limit?.retryAfterSeconds))
        ? Math.max(0, Math.ceil(Number(limit.retryAfterSeconds)))
        : null
    };
  }

  // This callback must read/validate against the current authoritative password.
  // No positive password result is cached by this core.
  const validPassword = await validate({ ...context, password: input.password });
  if (!validPassword) {
    await recordFailure(context);
    return { ok: false, status: 401, code: 'answer_password_invalid' };
  }

  await clearFailures(context);
  const issued = await issueCapability({
    secret,
    session,
    type: 'answer-view',
    viewId: input.viewId,
    lessonId: input.lessonId,
    resourceId: input.resourceId,
    accessVersion: input.accessVersion,
    ttlSeconds,
    now
  });

  return {
    ok: true,
    status: 200,
    token: issued.token,
    capability: issued.capability
  };
}
