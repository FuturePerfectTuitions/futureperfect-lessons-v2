import assert from 'node:assert/strict';
import {
  PREFLIGHT_GUARD_MARKER,
  handleAdminResourceRequest
} from '../worker/src/admin-resource-replace-consistency.js';

assert.equal(PREFLIGHT_GUARD_MARKER, 'replace-resource-preflight-pass-v1');

const origin = 'https://futureperfecttuitions.github.io';
const env = {
  ALLOWED_ORIGINS: origin,
  ADMIN_IMPORT_SESSION_SECRET: 'unused-for-preflight'
};

let response = await handleAdminResourceRequest(new Request(
  'https://worker.example/api/v1/admin/resources/replace',
  {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization'
    }
  }
), env);

assert.equal(response.status, 200, 'Replace Resource CORS preflight must remain HTTP 200');
assert.equal(response.headers.get('access-control-allow-origin'), origin);
assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
assert.match(response.headers.get('access-control-allow-methods') || '', /OPTIONS/);
assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
assert.equal(
  response.headers.get('x-fpt-replace-resource-preflight-guard'),
  PREFLIGHT_GUARD_MARKER,
  'Preflight must expose the permanent guard marker so the deployed bundle can be verified'
);
let data = await response.json();
assert.deepEqual(data, { ok: true }, 'Consistency wrapper must not reinterpret preflight as a replacement success');

response = await handleAdminResourceRequest(new Request(
  'https://worker.example/api/v1/admin/resources/replace',
  { method: 'GET', headers: { origin } }
), env);
assert.equal(response.status, 405, 'Non-POST methods must pass through to the base resource handler');
data = await response.json();
assert.equal(data.error, 'METHOD_NOT_ALLOWED');

response = await handleAdminResourceRequest(new Request(
  'https://worker.example/api/v1/admin/resources/replace',
  { method: 'POST', headers: { origin }, body: new FormData() }
), env);
assert.equal(response.status, 401, 'Unauthenticated replacement POST must remain protected');
data = await response.json();
assert.equal(data.error, 'UNAUTHORISED');
assert.equal(response.headers.get('access-control-allow-origin'), origin);

console.log('ADMIN_RESOURCE_REPLACE_CONSISTENCY_VERIFICATION_PASS');
