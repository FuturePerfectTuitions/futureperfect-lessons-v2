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

  function showLookupStatus(text, kind='') {
    const el = $('portalLookupStatus');
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
        showStatus(`${data.batch.batchKey} created and selected. Continue with Create Student Login.`, 'good');
      } else {
        showStatus(`${data.batch.batchKey} was created. Refresh Active Batches and select it.`, 'good');
      }
    } catch (error) {
      if (error.code === 'BATCH_ALREADY_EXISTS') {
        const checkbox = await refreshAndSelectBatch(batchKey);
        if (checkbox) {
          showStatus(`${batchKey} already exists and has been selected. Continue with Create Student Login.`, 'good');
        } else {
          showStatus(`Batch code ${batchKey} is already in use. Choose a different batch code.`, 'bad');
        }
        return;
      }

      let message = `Could not create batch: ${error.message}`;
      if (error.code === 'TEMPLATE_BATCH_NOT_FOUND') message = 'The batch being copied no longer exists. Refresh Active Batches and choose another template.';
      else if (error.code === 'TEMPLATE_NOT_ACTIVE_ON_DATE') message = `${copyFromBatchKey} is not active on ${activeFrom}. Choose an active template/date.`;
      else if (error.code === 'INVALID_BATCH_KEY') message = 'The new batch code is not valid.';
      else if (error.code === 'ACTIVE_FROM_REQUIRED') message = 'Enter a valid Active from date.';
      else if (error.code === 'BATCH_CREATE_FAILED') message = 'Could not create the batch. Please try again.';
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

  const home = $('adminToolsHome');
  const grid = home?.querySelector('.admin-tools-grid');
  if (grid && !$('portalLookupAdminTool')) {
    const card = document.createElement('div');
    card.className = 'admin-tool';
    card.id = 'portalLookupAdminTool';
    card.innerHTML = '<h3>Portal Login Details</h3><p>Look up an existing Portal ID without changing the account.</p><button type="button" data-admin-target="portalLookupSection">Open Portal Login Details</button>';
    grid.appendChild(card);
  }

  if (!$('portalLookupSection')) {
    const lookupSection = document.createElement('section');
    lookupSection.className = 'admin-section';
    lookupSection.id = 'portalLookupSection';
    lookupSection.innerHTML = `
      <h2>Portal Login Details</h2>
      <p class="muted">Read-only lookup for an existing Portal ID. This does not reset passwords or alter batches, entitlements, sessions or account state.</p>
      <div class="row">
        <div><label for="portalLookupId">Portal ID</label><input id="portalLookupId" type="text" autocomplete="off" placeholder="e.g. Eva2409"></div>
        <button id="portalLookupBtn" type="button">Find</button>
      </div>
      <div id="portalLookupStatus" class="status hidden"></div>
      <div id="portalLookupResult" class="trial-credential-box hidden">
        <div class="state-title">Portal account found</div>
        <div class="credential-grid">
          <div>Username</div><div id="portalLookupUsername" class="credential-value"></div>
          <div>Name</div><div id="portalLookupName"></div>
          <div>Account state</div><div id="portalLookupAccountState"></div>
          <div>Login password</div><div id="portalLookupLoginStored"></div>
          <div>Answer Pack password</div><div id="portalLookupAnswerStored"></div>
        </div>
      </div>`;
    section.after(lookupSection);
  }

  function hideLookupResult() {
    $('portalLookupResult')?.classList.add('hidden');
  }

  async function lookupPortalId() {
    const portalUserId = String($('portalLookupId')?.value || '').trim();
    if (!portalUserId) return showLookupStatus('Enter a Portal ID.', 'bad');
    if (!/^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(portalUserId)) {
      return showLookupStatus('Enter a valid Portal ID.', 'bad');
    }

    const button = $('portalLookupBtn');
    button.disabled = true;
    hideLookupResult();
    showLookupStatus(`Looking up ${portalUserId}…`, 'warn');
    try {
      const data = await api('/api/v1/admin/students/lookup', { portalUserId });
      $('portalLookupUsername').textContent = data.portalUserId || portalUserId;
      $('portalLookupName').textContent = data.firstName || '—';
      $('portalLookupAccountState').textContent = data.accountStatus || 'unknown';
      $('portalLookupLoginStored').textContent = data.loginPasswordStored ? 'Stored' : 'Not stored';
      $('portalLookupAnswerStored').textContent = data.answerPasswordStored ? 'Stored' : 'Not stored';
      $('portalLookupResult').classList.remove('hidden');
      showLookupStatus('Portal account loaded. No account data was changed.', 'good');
    } catch (error) {
      if (error.code === 'STUDENT_NOT_FOUND') showLookupStatus(`No Portal account found for ${portalUserId}.`, 'bad');
      else if (error.code === 'UNAUTHORISED') showLookupStatus('Sign in to Admin again.', 'bad');
      else showLookupStatus(`Could not load Portal account: ${error.message}`, 'bad');
    } finally {
      button.disabled = false;
    }
  }

  $('portalLookupBtn')?.addEventListener('click', lookupPortalId);
  $('portalLookupId')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupPortalId();
    }
  });
})();
