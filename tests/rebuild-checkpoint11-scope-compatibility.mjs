import assert from 'node:assert/strict';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { deriveOpaqueScopeId } from '../worker/src/checkpoint4-shadow-access.mjs';

const secret='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
for(const user of ['student0101','MixedCase0202',' spaces0303 ']) {
  const actual=await opaqueAccessScopeId(user,secret);
  const legacy=await deriveOpaqueScopeId(user,secret);
  assert.equal(actual,legacy,`Student runtime scope must remain compatible with live CP4 shadow publisher for ${user.trim().toLowerCase()}`);
  assert.match(actual,/^u-[0-9a-f]{40}$/);
}
console.log('REBUILD_CHECKPOINT11_SCOPE_COMPATIBILITY_PASS');
