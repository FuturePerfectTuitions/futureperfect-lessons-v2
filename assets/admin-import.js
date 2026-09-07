(() => {
  'use strict';

  const WORKER_BASE = 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev';
  const SESSION_KEY = 'fpt_admin_import_session_v1';
  const state = {
    token: sessionStorage.getItem(SESSION_KEY) || '',
    csv: '',
    filename: '',
    digest: '',
    preview: null,
    results: null
  };

  const $ = id => document.getElementById(id);
  const loginPanel = $('login-panel');
  const importPanel = $('import-panel');
  const loginForm = $('login-form');
  const loginMessage = $('login-message');
  const importMessage = $('import-message');
  const fileInput = $('csv-file');
  const fileName = $('file-name');
  const previewButton = $('preview-button');
  const confirmButton = $('confirm-button');
  const previewArea = $('preview-area');
  const previewBody = $('preview-body');
  const summary = $('summary');
  const resultArea = $('result-area');
  const resultSummary = $('result-summary');
  const downloadResults = $('download-results');

  function setMessage(element, text, type = '') {
    element.textContent = text || '';
    element.className = `message${type ? ` ${type}` : ''}`;
    element.hidden = !text;
  }

  function showAuthenticated(authenticated) {
    loginPanel.hidden = authenticated;
    importPanel.hidden = !authenticated;
  }

  function clearSession(message = '') {
    state.token = '';
    sessionStorage.removeItem(SESSION_KEY);
    showAuthenticated(false);
    if (message) setMessage(loginMessage, message, 'error');
  }

  async function api(path, body, authenticated = true) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (authenticated && state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(`${WORKER_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'INVALID_SERVER_RESPONSE' }));
    if (response.status === 401 && authenticated) clearSession('Admin session expired. Please sign in again.');
    if (!response.ok) {
      const error = new Error(data.message || data.error || `Request failed (${response.status})`);
      error.data = data;
      throw error;
    }
    return data;
  }

  function summaryCards(target, values) {
    target.replaceChildren();
    for (const [label, value] of values) {
      const card = document.createElement('div');
      card.className = 'summary-card';
      const strong = document.createElement('strong');
      strong.textContent = String(value);
      const span = document.createElement('span');
      span.textContent = label;
      card.append(strong, span);
      target.append(card);
    }
  }

  function cell(text) {
    const td = document.createElement('td');
    td.textContent = String(text ?? '');
    return td;
  }

  function renderPreview(data) {
    state.preview = data;
    state.digest = data.digest;
    previewBody.replaceChildren();
    for (const row of data.rows || []) {
      const tr = document.createElement('tr');
      tr.append(
        cell(row.rowNumber),
        cell(row.name),
        cell(row.portalUserId),
        cell(row.batchId),
        cell(row.csvLessonId),
        cell(row.portalLessonId),
        cell(row.lessonDate),
        cell(row.releaseType)
      );

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status status-${row.category || 'no-op'}`;
      badge.textContent = row.status || '';
      statusCell.append(badge);
      tr.append(statusCell);

      const messageCell = cell(row.message);
      for (const warning of row.warnings || []) {
        const warningNode = document.createElement('span');
        warningNode.className = 'warning';
        warningNode.textContent = `Warning: ${warning}`;
        messageCell.append(warningNode);
      }
      tr.append(messageCell);
      previewBody.append(tr);
    }

    const s = data.summary || {};
    summaryCards(summary, [
      ['Rows', s.total || 0],
      ['Ready', s.ready || 0],
      ['Already/no change', s.noOp || 0],
      ['Skipped', s.skipped || 0],
      ['Duplicates', s.duplicates || 0],
      ['Errors', s.errors || 0]
    ]);
    previewArea.hidden = false;
    resultArea.hidden = true;
    confirmButton.disabled = !(s.ready > 0);
  }

  function resetPreview() {
    state.digest = '';
    state.preview = null;
    state.results = null;
    previewArea.hidden = true;
    resultArea.hidden = true;
    confirmButton.disabled = true;
    setMessage(importMessage, '');
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage(loginMessage, '');
    const password = $('admin-password').value;
    try {
      const data = await api('/api/v1/admin/lesson-releases/login', { password }, false);
      state.token = data.token;
      sessionStorage.setItem(SESSION_KEY, state.token);
      $('admin-password').value = '';
      showAuthenticated(true);
    } catch (error) {
      setMessage(loginMessage, error.message, 'error');
    }
  });

  $('sign-out').addEventListener('click', () => clearSession());

  fileInput.addEventListener('change', async () => {
    resetPreview();
    const file = fileInput.files?.[0];
    if (!file) {
      state.csv = '';
      state.filename = '';
      fileName.textContent = '';
      previewButton.disabled = true;
      return;
    }
    state.filename = file.name;
    state.csv = await file.text();
    fileName.textContent = `${file.name} · ${file.size.toLocaleString()} bytes`;
    previewButton.disabled = !state.csv;
  });

  previewButton.addEventListener('click', async () => {
    if (!state.csv) return;
    previewButton.disabled = true;
    setMessage(importMessage, 'Validating CSV against Portal V2…');
    try {
      const data = await api('/api/v1/admin/lesson-releases/preview', { filename: state.filename, csv: state.csv });
      renderPreview(data);
      setMessage(importMessage, 'Preview complete. No Portal access has been changed.', 'success');
    } catch (error) {
      setMessage(importMessage, error.message, 'error');
    } finally {
      previewButton.disabled = !state.csv;
    }
  });

  confirmButton.addEventListener('click', async () => {
    if (!state.csv || !state.digest || !state.preview?.summary?.ready) return;
    const count = state.preview.summary.ready;
    if (!window.confirm(`Confirm ${count} Portal release change${count === 1 ? '' : 's'}?`)) return;
    confirmButton.disabled = true;
    setMessage(importMessage, 'Revalidating and importing confirmed releases…');
    try {
      const data = await api('/api/v1/admin/lesson-releases/confirm', {
        filename: state.filename,
        csv: state.csv,
        digest: state.digest
      });
      state.results = data.results || [];
      const s = data.summary || {};
      summaryCards(resultSummary, [
        ['Rows', s.total || 0],
        ['Changed', s.changed || 0],
        ['Full', s.full || 0],
        ['PreLesson only', s.prelesson || 0],
        ['No change', s.noChange || 0],
        ['Failed', s.failed || 0]
      ]);
      resultArea.hidden = false;
      setMessage(importMessage, s.failed ? `Import completed with ${s.failed} failed row(s).` : 'Import completed successfully.', s.failed ? 'error' : 'success');
    } catch (error) {
      setMessage(importMessage, error.message, 'error');
      confirmButton.disabled = false;
    }
  });

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  downloadResults.addEventListener('click', () => {
    if (!state.results?.length) return;
    const headers = [
      'Row','Name','PortalUserID','BatchID','CSVLessonID','PortalLessonID','LessonDate',
      'LessonStatus','ReleaseType','PreviewStatus','ImportStatus','Result','Message'
    ];
    const lines = [headers.join(',')];
    for (const row of state.results) {
      lines.push([
        row.rowNumber,row.name,row.portalUserId,row.batchId,row.csvLessonId,row.portalLessonId,row.lessonDate,
        row.lessonStatus,row.releaseType,row.status,row.importStatus,row.ok ? 'Success' : 'Failure',row.importMessage || row.message
      ].map(csvEscape).join(','));
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const base = state.filename.replace(/\.csv$/i, '') || 'lesson-releases';
    link.href = url;
    link.download = `${base}-portal-results.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  showAuthenticated(Boolean(state.token));
})();
