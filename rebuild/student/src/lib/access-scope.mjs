const encoder = new TextEncoder();
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
export async function opaqueAccessScopeId(portalUserIdNorm, secret) {
  const user = norm(portalUserIdNorm);
  if (!user) throw new Error('A normalized Portal User ID is required to derive an opaque scope.');
  const keyText = clean(secret);
  if (!keyText) throw new Error('An access scope secret is required.');
  const domain = `rebuild-shadow-scope-v1:${user}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyText), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(domain)));
  return `u-${[...signature].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,40)}`;
}
