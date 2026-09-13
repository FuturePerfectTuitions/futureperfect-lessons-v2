const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE_NAME = 'fpt_session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const CAPABILITY_MAX_AGE_SECONDS = 5 * 60;
export const TOKEN_ISSUER = 'fpt-portal-v2';
export const CAPABILITY_TYPES = Object.freeze(['video', 'download', 'answer-view']);

export class AuthTokenError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuthTokenError';
    this.code = code;
  }
}

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto subtle API is required');
  return globalThis.crypto.subtle;
}

function nowSeconds(now = Date.now()) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(Number(value))) throw new TypeError('now must be a finite millisecond timestamp');
  return Math.floor(Number(value) / 1000);
}

function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder is available');
}

function base64ToBytes(value) {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(value, 'base64'));
  throw new Error('No base64 decoder is available');
}

function b64urlEncodeBytes(bytes) {
  return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecodeBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw new AuthTokenError('token_malformed');
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const decoded = base64ToBytes(padded);
    if (b64urlEncodeBytes(decoded) !== String(value)) throw new AuthTokenError('token_malformed');
    return decoded;
  } catch (error) {
    if (error instanceof AuthTokenError) throw error;
    throw new AuthTokenError('token_malformed');
  }
}

function b64urlEncodeJson(value) {
  return b64urlEncodeBytes(encoder.encode(JSON.stringify(value)));
}

function b64urlDecodeJson(value) {
  try {
    return JSON.parse(decoder.decode(b64urlDecodeBytes(value)));
  } catch (error) {
    if (error instanceof AuthTokenError) throw error;
    throw new AuthTokenError('token_malformed');
  }
}

function randomId(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return b64urlEncodeBytes(bytes);
}

function requiredIdentifier(value, field) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${field} must be a non-empty safe identifier`);
  }
  return text;
}

function normaliseUserId(value) {
  return requiredIdentifier(value, 'userId').toLowerCase();
}

function requireSecret(secret) {
  const text = String(secret ?? '');
  if (encoder.encode(text).byteLength < 32) {
    throw new TypeError('signing secret must be at least 32 UTF-8 bytes');
  }
  return text;
}

async function hmacKey(secret) {
  return subtle().importKey(
    'raw',
    encoder.encode(requireSecret(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signPayload(secret, payload) {
  const encodedPayload = b64urlEncodeJson(payload);
  const signingInput = `fpt1.${encodedPayload}`;
  const signature = await subtle().sign('HMAC', await hmacKey(secret), encoder.encode(signingInput));
  return `${signingInput}.${b64urlEncodeBytes(new Uint8Array(signature))}`;
}

async function verifySignedPayload(secret, token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'fpt1') throw new AuthTokenError('token_malformed');
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = b64urlDecodeBytes(parts[2]);
  const valid = await subtle().verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(signingInput)
  );
  if (!valid) throw new AuthTokenError('token_signature_invalid');
  const payload = b64urlDecodeJson(parts[1]);
  if (!payload || payload.v !== 1 || payload.iss !== TOKEN_ISSUER) {
    throw new AuthTokenError('token_claims_invalid');
  }
  return payload;
}

function assertTimeWindow(payload, { now, maxLifetimeSeconds, exactLifetimeSeconds = null }) {
  const current = nowSeconds(now);
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= payload.iat) {
    throw new AuthTokenError('token_claims_invalid');
  }
  const lifetime = payload.exp - payload.iat;
  if (exactLifetimeSeconds !== null && lifetime !== exactLifetimeSeconds) {
    throw new AuthTokenError('token_lifetime_invalid');
  }
  if (lifetime > maxLifetimeSeconds) throw new AuthTokenError('token_lifetime_invalid');
  if (payload.exp <= current) throw new AuthTokenError('token_expired');
  if (payload.iat > current + 60) throw new AuthTokenError('token_not_yet_valid');
}

export async function issueSessionToken({ secret, userId, now = Date.now() }) {
  const iat = nowSeconds(now);
  const payload = {
    v: 1,
    iss: TOKEN_ISSUER,
    kind: 'session',
    sub: normaliseUserId(userId),
    sid: randomId(18),
    iat,
    exp: iat + SESSION_MAX_AGE_SECONDS
  };
  return {
    token: await signPayload(secret, payload),
    session: payload
  };
}

export async function verifySessionToken({ secret, token, now = Date.now(), expectedUserId = null }) {
  const payload = await verifySignedPayload(secret, token);
  if (payload.kind !== 'session') throw new AuthTokenError('session_kind_invalid');
  assertTimeWindow(payload, {
    now,
    maxLifetimeSeconds: SESSION_MAX_AGE_SECONDS,
    exactLifetimeSeconds: SESSION_MAX_AGE_SECONDS
  });
  normaliseUserId(payload.sub);
  requiredIdentifier(payload.sid, 'sessionId');
  if (expectedUserId !== null && payload.sub !== normaliseUserId(expectedUserId)) {
    throw new AuthTokenError('session_user_mismatch');
  }
  return payload;
}

export function serializeSessionCookie(token) {
  const value = String(token ?? '');
  if (!value || /[;\r\n]/.test(value)) throw new TypeError('invalid session token');
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].filter(Boolean).join('; ');
}

export function sessionTokenFromCookie(cookieHeader) {
  const cookies = String(cookieHeader ?? '').split(';');
  for (const pair of cookies) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    if (name === SESSION_COOKIE_NAME) return pair.slice(index + 1).trim();
  }
  return '';
}

export async function createAuthenticatedSession({ secret, userId, now = Date.now() }) {
  const issued = await issueSessionToken({ secret, userId, now });
  return {
    ...issued,
    setCookie: serializeSessionCookie(issued.token)
  };
}

function validateCapabilityType(type) {
  const value = String(type ?? '').trim();
  if (!CAPABILITY_TYPES.includes(value)) throw new TypeError('unsupported capability type');
  return value;
}

function capabilityClaims({ type, session, viewId, lessonId, resourceId, accessVersion, iat, ttlSeconds }) {
  if (!session || session.kind !== 'session') throw new TypeError('a verified session payload is required');
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > CAPABILITY_MAX_AGE_SECONDS) {
    throw new TypeError(`capability ttl must be between 1 and ${CAPABILITY_MAX_AGE_SECONDS} seconds`);
  }
  if (!Number.isInteger(session.iat) || !Number.isInteger(session.exp) ||
      session.exp - session.iat !== SESSION_MAX_AGE_SECONDS || session.exp <= iat) {
    throw new AuthTokenError('session_expired_or_invalid');
  }
  const exp = Math.min(iat + ttl, session.exp);
  return {
    v: 1,
    iss: TOKEN_ISSUER,
    kind: 'capability',
    cap: validateCapabilityType(type),
    sub: normaliseUserId(session.sub),
    sid: requiredIdentifier(session.sid, 'sessionId'),
    view: requiredIdentifier(viewId, 'viewId'),
    lesson: requiredIdentifier(lessonId, 'lessonId'),
    resource: requiredIdentifier(resourceId, 'resourceId'),
    access: accessVersion === undefined || accessVersion === null || accessVersion === ''
      ? null
      : requiredIdentifier(accessVersion, 'accessVersion'),
    jti: randomId(18),
    iat,
    exp
  };
}

export async function issueCapability({
  secret,
  session,
  type,
  viewId,
  lessonId,
  resourceId,
  accessVersion = null,
  ttlSeconds = CAPABILITY_MAX_AGE_SECONDS,
  now = Date.now()
}) {
  const iat = nowSeconds(now);
  const payload = capabilityClaims({ type, session, viewId, lessonId, resourceId, accessVersion, iat, ttlSeconds });
  return {
    token: await signPayload(secret, payload),
    capability: payload
  };
}

function completeExpectedBinding(expected) {
  if (!expected || typeof expected !== 'object') throw new TypeError('expected binding is required');
  return {
    type: validateCapabilityType(expected.type),
    userId: normaliseUserId(expected.userId),
    sessionId: requiredIdentifier(expected.sessionId, 'sessionId'),
    viewId: requiredIdentifier(expected.viewId, 'viewId'),
    lessonId: requiredIdentifier(expected.lessonId, 'lessonId'),
    resourceId: requiredIdentifier(expected.resourceId, 'resourceId'),
    accessVersion: expected.accessVersion === undefined || expected.accessVersion === null || expected.accessVersion === ''
      ? null
      : requiredIdentifier(expected.accessVersion, 'accessVersion')
  };
}

export async function verifyCapability({ secret, token, expected, now = Date.now() }) {
  const payload = await verifySignedPayload(secret, token);
  if (payload.kind !== 'capability') throw new AuthTokenError('capability_kind_invalid');
  assertTimeWindow(payload, { now, maxLifetimeSeconds: CAPABILITY_MAX_AGE_SECONDS });
  const binding = completeExpectedBinding(expected);
  const checks = [
    ['cap', binding.type, 'capability_type_mismatch'],
    ['sub', binding.userId, 'capability_user_mismatch'],
    ['sid', binding.sessionId, 'capability_session_mismatch'],
    ['view', binding.viewId, 'capability_view_mismatch'],
    ['lesson', binding.lessonId, 'capability_lesson_mismatch'],
    ['resource', binding.resourceId, 'capability_resource_mismatch'],
    ['access', binding.accessVersion, 'capability_access_mismatch']
  ];
  for (const [field, value, code] of checks) {
    if ((payload[field] ?? null) !== value) throw new AuthTokenError(code);
  }
  requiredIdentifier(payload.jti, 'capabilityId');
  return payload;
}

export async function timingSafeEqualText(left, right) {
  const a = encoder.encode(String(left ?? ''));
  const b = encoder.encode(String(right ?? ''));
  const maxLength = Math.max(a.length, b.length, 1);
  const paddedA = new Uint8Array(maxLength);
  const paddedB = new Uint8Array(maxLength);
  paddedA.set(a.subarray(0, maxLength));
  paddedB.set(b.subarray(0, maxLength));
  const keyBytes = new Uint8Array(32);
  keyBytes.fill(0x5a);
  const key = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [macA, macB] = await Promise.all([
    subtle().sign('HMAC', key, paddedA),
    subtle().sign('HMAC', key, paddedB)
  ]);
  const aa = new Uint8Array(macA);
  const bb = new Uint8Array(macB);
  let diff = a.length ^ b.length;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
