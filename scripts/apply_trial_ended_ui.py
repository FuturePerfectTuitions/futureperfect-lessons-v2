from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'rebuild' / 'browser-ui'
APP = UI / 'src' / 'app.js'
CSS = UI / 'src' / 'styles.css'

s = APP.read_text(encoding='utf-8')
if 'function isTrialEndedError(error)' not in s:
    old = """function friendlyError(error) {
  if (error?.name === 'AbortError') return 'This is taking longer than expected. Please try again.';
  if (error?.message === 'ACCOUNT_LOCKED') return 'Your access to Future Perfect Material has now been withdrawn.';
  return 'This part of the portal could not be loaded. Please try again.';
}"""
    new = """function isTrialEndedError(error) {
  return error?.message === 'TRIAL_ACCESS_ENDED' || error?.payload?.error === 'TRIAL_ACCESS_ENDED';
}

function friendlyError(error) {
  if (error?.name === 'AbortError') return 'This is taking longer than expected. Please try again.';
  if (error?.message === 'ACCOUNT_LOCKED') return 'Your access to Future Perfect Material has now been withdrawn.';
  if (isTrialEndedError(error)) return 'Your Future Perfect trial has now ended.\\nTo continue accessing lessons and resources, please contact us to discuss the right programme for your child.';
  return 'This part of the portal could not be loaded. Please try again.';
}"""
    if old not in s:
        raise SystemExit('friendlyError anchor not found')
    s = s.replace(old, new, 1)

    old = "button.disabled = true; button.textContent = 'Logging in…'; error.hidden = true;"
    new = "button.disabled = true; button.textContent = 'Logging in…'; error.hidden = true; error.classList.remove('trial-ended');"
    if old not in s:
        raise SystemExit('login start anchor not found')
    s = s.replace(old, new, 1)

    old = "error.textContent = err.status === 401 ? 'Invalid username or password.' : friendlyError(err);\n      error.hidden = false;"
    new = "error.textContent = err.status === 401 ? 'Invalid username or password.' : friendlyError(err);\n      error.classList.toggle('trial-ended', isTrialEndedError(err));\n      error.hidden = false;"
    if old not in s:
        raise SystemExit('login catch anchor not found')
    s = s.replace(old, new, 1)

    old = '''function renderPortalError(title, error, retry) {
  root.innerHTML = shell(`<section class="card"><p class="eyebrow">Student Portal</p><h1>${escapeHtml(title)}</h1><div class="error-box" role="alert">${escapeHtml(friendlyError(error))}</div><p><button id="retry" class="button button-primary" type="button">Try again</button></p></section>`, { portal: true });'''
    new = '''function renderPortalError(title, error, retry) {
  const errorClass = isTrialEndedError(error) ? 'error-box trial-ended' : 'error-box';
  root.innerHTML = shell(`<section class="card"><p class="eyebrow">Student Portal</p><h1>${escapeHtml(title)}</h1><div class="${errorClass}" role="alert">${escapeHtml(friendlyError(error))}</div><p><button id="retry" class="button button-primary" type="button">Try again</button></p></section>`, { portal: true });'''
    if old not in s:
        raise SystemExit('portal error anchor not found')
    s = s.replace(old, new, 1)
    APP.write_text(s, encoding='utf-8')

c = CSS.read_text(encoding='utf-8')
rule = '.error-box.trial-ended{background:#eef8f3;color:#174c3a;border-color:#b8dfce;white-space:pre-line;font-weight:500}'
if rule not in c:
    CSS.write_text(c + rule, encoding='utf-8')

(UI / 'assets').mkdir(parents=True, exist_ok=True)
(UI / 'assets' / 'fpt-logo.png').write_bytes((ROOT / 'assets' / 'fpt-logo.png').read_bytes())

package = {
    'name': 'fpt-portal-v2-rebuilt-browser-ui',
    'private': True,
    'version': '1.0.0',
    'type': 'module',
    'scripts': {'build': 'vite build'},
    'devDependencies': {'vite': '7.1.5'}
}
(UI / 'package.json').write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
(UI / 'vite.config.js').write_text("""import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    sourcemap: true,
    rollupOptions: {
      external: id => id === './protected-viewer.js' || id.endsWith('/protected-viewer.js'),
      output: {
        entryFileNames: 'assets/portal-[hash].js',
        chunkFileNames: 'assets/portal-[hash].js',
        assetFileNames: 'assets/portal-[hash][extname]'
      }
    }
  }
});
""", encoding='utf-8')

assert 'TRIAL_ACCESS_ENDED' in APP.read_text(encoding='utf-8')
assert 'Your Future Perfect trial has now ended.' in APP.read_text(encoding='utf-8')
assert 'right programme for your child.' in APP.read_text(encoding='utf-8')
assert '.error-box.trial-ended' in CSS.read_text(encoding='utf-8')
print('TRIAL_ENDED_SOURCE_PATCH_PASS')
