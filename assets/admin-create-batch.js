(() => {
  const workerMeta = document.querySelector('meta[name="fpt-worker-base"]');
  const section = document.getElementById('studentManagerSection');
  const choices = document.getElementById('studentBatchChoices');
  if (!workerMeta || !section || !choices) return;

  const worker = workerMeta.content.replace(/\/$/, '');
  const TOKEN_KEY = 'fptAdminImportToken';
  const $ = id => document.getElementById(id);
  let activeFromDirty = false;

  function showStatus(text, kind='') {
    const el = $('studentBatchCreateStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  async function api(path, body={}) {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) throw Object.assign(new Error('Sign in to Admin first.'), { code:'UNAUTHORISED' });
    const response = await fetch(`${worker}${path}`, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        authorization:`Bearer ${token}`
      },
      body:JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.code = data.error || '';
      error.data = data;
      throw error;
    }
    return data;
  }

  function canonicalBatchKey(value) {
    return String(value || '').trim().toUpperCase();
  }

  const panel = document.createElement('div');
  panel.id = 'studentBatchCreatePanel';
  panel.className = 'source-box';
  panel.style.marginTop = '14px';
  panel.innerHTML = `
    <div class="source-title">Create a new batch</div>
    <p class="muted" style="margin:4px 0 12px">For a new class, enter its new batch code and copy the year, subject and stream settings from an existing batch. The new batch will then appear below and can be selected for this student.</p>
    <div class="row">
      <div><label for="newStudentBatchKey">New batch code</label><input id="newStudentBatchKey" type="text" autocomplete="off" placeholder="e.g. Y411OE2"></div>
      <div><label for="newStudentBatchTemplate">Copy settings from</label><select id="newStudentBatchTemplate"><option value="">Loading active batches…</option></select></div>
      <div><label for="newStudentBatchActiveFrom">Active from</label><input id="newStudentBatchActiveFrom" type="date"></div>
      <button id="createStudentBatchBtn" type="button">Create Batch</button>
    </div>
    <div id="studentBatchCreateStatus" class="status hidden"></div>`;
  choices.before(panel);

  function refreshTemplateOptions() {
    const select = $('newStudentBatchTemplate');
    if (!select) return;
    const current = select.value;
    const rows = [...choices.querySelectorAll('input[data-student-batch]')]
      .map(input => {
        const label = input.closest('label');
        const key = String(input.dataset.studentBatch || '').trim();
        const rawText = String(label?.textContent || key).replace(/\s+/g, ' ').trim();
        const detail = rawText.toUpperCase().startsWith(key.toUpperCase())
          ? rawText.slice(key.length).trim()
          : rawText;
        return {
          key,
          text:detail && detail !== key ? `${key} ${detail}` : key
        };
      })
      .filter(row => row.key)
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric:true }));

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = rows.length ? 'Choose an existing batch' : 'No active batches loaded';
    select.appendChild(placeholder);
    for (const row of rows) {
      const option = document.createElement('option');
      option.value = row.key;
      option.textContent = row.text;
      select.appendChild(option);
    }
    if (rows.some(row => row.key === current)) select.value = current;
  }

  async function waitForBatchCheckbox(batchKey, timeoutMs=8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = [...choices.querySelectorAll('input[data-student-batch]')]
        .find(node => String(node.dataset.studentBatch || '').toUpperCase() === batchKey);
      if (input) return input;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  async function refreshAndSelectBatch(batchKey) {
    document.getElementById('refreshStudentBatchesBtn')?.click();
    const checkbox = await waitForBatchCheckbox(batchKey);
    if (!checkbox) return null;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles:true }));
    checkbox.scrollIntoView({ behavior:'smooth', block:'nearest' });
    refreshTemplateOptions();
    return checkbox;
  }

  async function createBatch() {
    const batchKey = canonicalBatchKey($('newStudentBatchKey')?.value);
    const copyFromBatchKey = canonicalBatchKey($('newStudentBatchTemplate')?.value);
    const activeFrom = $('newStudentBatchActiveFrom')?.value || '';
    const button = $('createStudentBatchBtn');

    if (!batchKey) return showStatus('Enter the new batch code.', 'bad');
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(batchKey)) return showStatus('Use only letters, numbers, hyphens or underscores in the batch code.', 'bad');
    if (!copyFromBatchKey) return showStatus('Choose an existing batch to copy the settings from.', 'bad');
    if (!activeFrom) return showStatus('Enter the date the new batch becomes active.', 'bad');

    button.disabled = true;
    showStatus(`Creating ${batchKey}…`, 'warn');
    try {
      const data = await api('/api/v1/admin/students/batches/create', {
        batchKey,
        copyFromBatchKey,
        activeFrom
      });
      $('newStudentBatchKey').value = batchKey;
      const checkbox = await refreshAndSelectBatch(batchKey);
      if (checkbox) {
        showStatus(`${data.batch.batchKey} created from ${data.copiedFromBatchKey} and selected for this student.`, 'good');
      } else {
        showStatus(`${data.batch.batchKey} was created, but it is not visible in the active batch list after refresh. Do not create it again; check its active dates before continuing.`, 'bad');
      }
    } catch (error) {
      if (error.code === 'BATCH_ALREADY_EXISTS') {
        showStatus(`Checking existing ${batchKey}…`, 'warn');
        const checkbox = await refreshAndSelectBatch(batchKey);
        if (checkbox) {
          showStatus(`${batchKey} already exists and is active. It has now been selected for this student; continue with Create Student Login.`, 'good');
          return;
        }
        showStatus(`${batchKey} exists in the database but is not currently in the active batch list. It may be inactive or outside its active dates. No existing batch was changed. Use a different batch code, or inspect/reactivate the existing batch deliberately before assigning it.`, 'bad');
        return;
      }

      let message = `Could not create batch: ${error.message}`;
      if (error.code === 'TEMPLATE_BATCH_NOT_FOUND') message = 'The batch being copied no longer exists. Refresh Active Batches and choose another template.';
      else if (error.code === 'INVALID_BATCH_KEY') message = 'The new batch code is not valid.';
      else if (error.code === 'ACTIVE_FROM_REQUIRED') message = 'Enter a valid Active from date.';
      showStatus(message, 'bad');
    } finally {
      button.disabled = false;
    }
  }

  const joinDate = $('studentJoinDate');
  const activeFrom = $('newStudentBatchActiveFrom');
  activeFrom.value = joinDate?.value || '';
  activeFrom.addEventListener('input', () => { activeFromDirty = true; });
  joinDate?.addEventListener('change', () => {
    if (!activeFromDirty) activeFrom.value = joinDate.value;
  });
  joinDate?.addEventListener('input', () => {
    if (!activeFromDirty) activeFrom.value = joinDate.value;
  });

  $('newStudentBatchKey')?.addEventListener('input', event => {
    const start = event.target.selectionStart;
    const value = canonicalBatchKey(event.target.value);
    event.target.value = value;
    try { event.target.setSelectionRange(start, start); } catch { /* ignore */ }
  });
  $('createStudentBatchBtn')?.addEventListener('click', createBatch);

  const observer = new MutationObserver(refreshTemplateOptions);
  observer.observe(choices, { childList:true, subtree:true });
  refreshTemplateOptions();
})();
