import assert from 'node:assert/strict';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';

const encoder = new TextEncoder();
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
async function frozenCp4ScopeId(portalUserIdNorm, secret) {
  const user = norm(portalUserIdNorm);
  const domain = `rebuild-shadow-scope-v1:${user}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(String(secret)), { name:'HMAC', hash:'SHA-256' }, false, ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(domain)));
  const hex = [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `u-${hex.slice(0, 40)}`;
}

const secret='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
for (const user of ['student0101','MixedCase0202',' spaces0303 ']) {
  const actual = await opaqueAccessScopeId(user, secret);
  const legacy = await frozenCp4ScopeId(user, secret);
  assert.equal(actual, legacy, `Student runtime scope must remain compatible with frozen live CP4 shadow derivation for ${user.trim().toLowerCase()}`);
  assert.match(actual, /^u-[0-9a-f]{40}$/);
}
console.log('REBUILD_CHECKPOINT11_SCOPE_COMPATIBILITY_PASS');
