import fs from 'node:fs';

const [namespaceId, keysFile, outputFile] = process.argv.slice(2);
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!namespaceId || !keysFile || !outputFile || !accountId || !token) {
  throw new Error('Usage: phase11-kv-snapshot.mjs <namespace-id> <keys-json> <output-json> with Cloudflare env vars.');
}

const input = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
if (!Array.isArray(input) || !input.length) throw new Error('Snapshot key input is empty or invalid.');
const keys = input.map(item => typeof item === 'string' ? item : String(item?.key || '')).filter(Boolean);
if (new Set(keys).size !== keys.length) throw new Error('Snapshot key input contains duplicates.');

const values = {};
for (let offset = 0; offset < keys.length; offset += 100) {
  const chunk = keys.slice(offset, offset + 100);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: chunk, type: 'text', withMetadata: false })
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.result?.values) {
    throw new Error(`Cloudflare KV bulk snapshot failed at offset ${offset}: HTTP ${response.status}`);
  }
  for (const key of chunk) {
    values[key] = Object.prototype.hasOwnProperty.call(body.result.values, key)
      ? body.result.values[key]
      : null;
  }
}

fs.writeFileSync(outputFile, JSON.stringify({ namespaceId, keys, values }, null, 2), 'utf8');
console.log(JSON.stringify({ status: 'PASS', snapshottedKeys: keys.length, outputFile }));
