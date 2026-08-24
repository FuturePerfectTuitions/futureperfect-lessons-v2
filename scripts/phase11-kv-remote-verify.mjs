import fs from 'node:fs';

const [namespaceId, plannedFile] = process.argv.slice(2);
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!namespaceId || !plannedFile || !accountId || !token) {
  throw new Error('Usage: phase11-kv-remote-verify.mjs <namespace-id> <planned-bulk.json> with Cloudflare env vars.');
}

const planned = JSON.parse(fs.readFileSync(plannedFile, 'utf8'));
if (!Array.isArray(planned) || !planned.length) throw new Error('Planned KV bulk file is empty or invalid.');
const expected = new Map(planned.map(row => [String(row.key), String(row.value)]));
if (expected.size !== planned.length) throw new Error('Planned KV bulk file contains duplicate keys.');

const keys = [...expected.keys()];
const remote = new Map();
for (let offset = 0; offset < keys.length; offset += 100) {
  const chunk = keys.slice(offset, offset + 100);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ keys: chunk, type: 'text', withMetadata: false })
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.result?.values) {
    throw new Error(`Cloudflare KV bulk get failed at offset ${offset}: HTTP ${response.status}`);
  }
  for (const [key, value] of Object.entries(body.result.values)) remote.set(key, String(value));
}

if (remote.size !== expected.size) throw new Error(`Remote KV result count mismatch: ${remote.size} vs ${expected.size}.`);
for (const [key, value] of expected) {
  if (!remote.has(key)) throw new Error(`Remote KV is missing ${key}.`);
  if (remote.get(key) !== value) throw new Error(`Remote KV value mismatch for ${key}.`);
}

console.log(JSON.stringify({ verifiedKeys: remote.size, status: 'PASS' }));
