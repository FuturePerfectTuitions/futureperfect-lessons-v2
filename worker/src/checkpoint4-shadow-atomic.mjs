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
  if (candidate.envelopeSha256 && envelopeSha !== candidate.envelopeSha256) return null;
  return { envelope, payloadSha256: payloadSha, envelopeSha256: envelopeSha };
}

async function publishScopeAtomic(store, options = {}) {
  const scope = clean(options.scope);
  const payload = options.payload;
  if (!scope || payload == null) throw new Error('scope and payload are required.');
  const payloadText = stableStringify(payload);
  const payloadSha256 = await sha256Hex(payloadText);
  let current = null;
  try { current = await resolveCurrentScope(store, scope); } catch {}
  if (current?.sha256 === payloadSha256) {
    return {
      scope,
      version: current.version,
      payloadSha256,
      envelopeSha256: current.envelopeSha256,
      previousVersion: clean(current.pointer?.previous?.version) || null,
      unchanged: true
    };
  }

  const version = clean(options.version) || `v-${payloadSha256.slice(0, 24)}-${Date.now()}`;
  const previousPointer = await readJson(store, pointerKey(scope));
  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'prepared-read-model-envelope',
    scope,
    version,
    sha256: payloadSha256,
    payload
  };
  const envelopeText = stableStringify(envelope);
  const envelopeSha256 = await sha256Hex(envelopeText);
  const candidate = { version, sha256: payloadSha256, envelopeSha256 };
  await store.put(versionKey(scope, version), envelopeText);
  const verified = await verifiedEnvelope(store, scope, candidate);
  if (!verified) throw new Error('Candidate read-model version did not verify after write.');

  const previous = previousPointer?.current?.version
    ? {
        version: clean(previousPointer.current.version),
        sha256: clean(previousPointer.current.sha256),
        envelopeSha256: clean(previousPointer.current.envelopeSha256)
      }
    : null;
  const pointer = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'prepared-read-model-pointer',
    scope,
    current: candidate,
    previous,
    updatedAt: clean(options.updatedAt) || new Date().toISOString()
  };
  await store.put(pointerKey(scope), stableStringify(pointer));
  const confirmed = await readJson(store, pointerKey(scope));
  if (clean(confirmed?.current?.version) !== version || clean(confirmed?.current?.sha256) !== payloadSha256) {
    throw new Error('Current-version pointer did not verify after write.');
  }
  return {
    scope,
    version,
    payloadSha256,
    envelopeSha256,
    previousVersion: previous?.version || null,
    unchanged: false
  };
}

async function resolveCurrentScope(store, scope) {
  const pointer = await readJson(store, pointerKey(scope));
  if (!pointer || pointer.kind !== 'prepared-read-model-pointer') throw new Error('READ_MODEL_POINTER_UNAVAILABLE');
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

function kvStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('A KV binding with get/put is required.');
  }
  return {
    async get(key) { return binding.get(key); },
    async put(key, value) { return binding.put(key, value); }
  };
}

export {
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  publishScopeAtomic,
  resolveCurrentScope,
  kvStore
};
