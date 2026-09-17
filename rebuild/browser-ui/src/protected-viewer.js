import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const q = selector => document.querySelector(selector);

export async function openProtectedViewer({ url, title = 'Answer Pack', watermark = 'Future Perfect Tuitions', onClose }) {
  const existing = q('#protected-viewer-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'protected-viewer-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="protected-viewer-title">
      <div class="protected-toolbar">
        <div><p class="eyebrow">Protected viewer</p><h2 id="protected-viewer-title"></h2></div>
        <button type="button" class="icon-button" data-close aria-label="Close protected viewer">×</button>
      </div>
      <div id="protected-document" class="protected-document"><div class="loading-row"><span class="spinner" aria-hidden="true"></span><span>Loading protected Answer Pack…</span></div></div>
    </section>`;
  backdrop.querySelector('#protected-viewer-title').textContent = title;
  const close = () => { backdrop.remove(); onClose?.(); };
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.body.append(backdrop);

  const host = backdrop.querySelector('#protected-document');
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`Protected document failed (${response.status})`);
    const data = await response.arrayBuffer();
    const task = pdfjs.getDocument({ data });
    const pdf = await task.promise;
    host.replaceChildren();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const available = Math.min(900, Math.max(280, host.clientWidth - 28));
      const scale = available / unscaled.width;
      const viewport = page.getViewport({ scale });
      const wrap = document.createElement('div');
      wrap.className = 'protected-page';
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-label', `Answer Pack page ${pageNumber}`);
      const mark = document.createElement('div');
      mark.className = 'watermark';
      mark.textContent = watermark;
      wrap.append(canvas, mark);
      host.append(wrap);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (error) {
    host.innerHTML = `<div class="error-box" role="alert"></div>`;
    host.querySelector('.error-box').textContent = error?.message || 'The protected Answer Pack could not be displayed.';
  }

  return { close };
}
