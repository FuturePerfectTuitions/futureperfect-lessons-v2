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

const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 20000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryAfterMs(response, attempt) {
  const raw = String(response?.headers?.get('retry-after') || '').trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_BACKOFF_MS, Math.max(1000, Math.ceil(seconds * 1000)));
  }
  return Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.max(0, attempt - 1)));
}

async function bulkGetWithRetry(chunk, offset) {
  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response = null;
    let body = null;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: chunk, type: 'text', withMetadata: false })
        }
      );
      lastStatus = response.status;
      body = await response.json().catch(() => null);
      if (response.ok && body?.success && body?.result?.values) return body.result.values;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delay = retryAfterMs(response, attempt);
      console.error(
        `Cloudflare KV snapshot temporary HTTP ${response.status} at offset ${offset}; ` +
        `retrying attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms.`
      );
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.max(0, attempt - 1)));
      console.error(
        `Cloudflare KV snapshot temporary network failure at offset ${offset}; ` +
        `retrying attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms.`
      );
      await sleep(delay);
    }
  }

  const suffix = lastError ? `: ${String(lastError?.message || lastError)}` : '';
  throw new Error(`Cloudflare KV bulk snapshot failed at offset ${offset}: HTTP ${lastStatus}${suffix}`);
}

const values = {};
for (let offset = 0; offset < keys.length; offset += 100) {
  const chunk = keys.slice(offset, offset + 100);
  const remoteValues = await bulkGetWithRetry(chunk, offset);
  for (const key of chunk) {
    values[key] = Object.prototype.hasOwnProperty.call(remoteValues, key)
      ? remoteValues[key]
      : null;
  }
}

fs.writeFileSync(outputFile, JSON.stringify({ namespaceId, keys, values }, null, 2), 'utf8');
console.log(JSON.stringify({ status: 'PASS', snapshottedKeys: keys.length, outputFile }));
