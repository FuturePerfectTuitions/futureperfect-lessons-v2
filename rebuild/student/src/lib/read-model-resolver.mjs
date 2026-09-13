const SCHEMA_VERSION = 1;
const KEY_PREFIX = 'rm:v1';

const clean = value => String(value ?? '').trim();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodedScope(scope) {
  const value = clean(scope);
  if (!value) throw new Error('A non-empty read-model scope is required.');
  return encodeURIComponent(value).replace(/%/g, '_');
}

function pointerKey(scope) {
  return `${KEY_PREFIX}:scope:${encodedScope(scope)}:current`;
}

function versionKey(scope, version) {
  const value = clean(version);
  if (!value) throw new Error('A non-empty version is required.');
  return `${KEY_PREFIX}:scope:${encodedScope(scope)}:version:${encodeURIComponent(value).replace(/%/g, '_')}`;
}

function kvReadStore(binding) {
  if (!binding || typeof binding.get !== 'function') {
    throw new Error('A read-only KV binding with get() is required.');
  }
  return {
    async get(key) { return binding.get(key); }
  };
}

async function readJson(store, key) {
  const raw = await store.get(key);
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

async function verifiedEnvelope(store, scope, candidate) {
  if (!candidate?.version || !candidate?.sha256) return null;
  const raw = await store.get(versionKey(scope, candidate.version));
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : stableStringify(raw);
  let envelope;
  try { envelope = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (envelope?.schemaVersion !== SCHEMA_VERSION || envelope?.kind !== 'prepared-read-model-envelope') return null;
  if (clean(envelope.scope) !== clean(scope) || clean(envelope.version) !== clean(candidate.version)) return null;
  const payloadText = stableStringify(envelope.payload);
  const payloadSha = await sha256Hex(payloadText);
  if (payloadSha !== clean(envelope.sha256) || payloadSha !== clean(candidate.sha256)) return null;
  const envelopeSha = await sha256Hex(text);
  if (candidate.envelopeSha256 && envelopeSha !== clean(candidate.envelopeSha256)) return null;
  return { envelope, payloadSha256: payloadSha, envelopeSha256: envelopeSha };
}

async function resolveCurrentScope(store, scope) {
  const pointer = await readJson(store, pointerKey(scope));
  if (!pointer || pointer.kind !== 'prepared-read-model-pointer') {
    throw new Error('READ_MODEL_POINTER_UNAVAILABLE');
  }
  for (const candidate of [pointer.current, pointer.previous]) {
    if (!candidate?.version) continue;
    const verified = await verifiedEnvelope(store, scope, candidate);
    if (verified) {
      return {
        scope: clean(scope),
        version: clean(candidate.version),
        sha256: clean(candidate.sha256),
        envelopeSha256: verified.envelopeSha256,
        payload: verified.envelope.payload,
        usedFallback: clean(candidate.version) !== clean(pointer.current?.version),
        pointer
      };
    }
  }
  throw new Error('READ_MODEL_NO_VERIFIED_VERSION');
}

export {
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  kvReadStore,
  resolveCurrentScope
};
