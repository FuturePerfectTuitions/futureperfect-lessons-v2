import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sourcePath = path.resolve('tests/phase16-browser-resource-session.mjs');
const runtimePath = path.resolve('tests/.phase16-browser-resource-session.runtime.mjs');

const original = await fs.readFile(sourcePath, 'utf8');
const needle = 'await eye.click();';
const occurrences = original.split(needle).length - 1;
if (occurrences < 4) {
  throw new Error(`Phase 16 eye-control stabilization expected at least 4 eye clicks; found ${occurrences}.`);
}

// GitHub-hosted headless browsers occasionally report the input type before
// the click-driven DOM mutation has settled. Preserve the real user click and
// the original assertions, but allow a short rendering turn after each eye
// control click. No production source is modified by this runner.
const stabilized = original.replaceAll(
  needle,
  `${needle}\n  await page.waitForTimeout(250);`
);

await fs.writeFile(runtimePath, stabilized, 'utf8');

try {
  const child = spawn(process.execPath, [runtimePath], {
    stdio: 'inherit',
    env: process.env
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', status => resolve(status ?? 1));
  });
  process.exitCode = code;
} finally {
  await fs.rm(runtimePath, { force: true }).catch(() => {});
}
