(() => {
  const workerMeta = document.querySelector('meta[name="fpt-worker-base"]');
  if (!workerMeta) return;
  const worker = workerMeta.content.replace(/\/$/, '');
  const TOKEN_KEY = 'fptAdminImportToken';
  const $ = id => document.getElementById(id);

  const VIEW_LABELS = Object.freeze({
    'maths-year2':'Year 2 Maths',
    'maths-year3':'Year 3 Maths',
    'maths-year4':'Year 4 Maths',
    'maths-year5':'Year 5 Maths',
    'maths-year6':'Year 6 Maths',
    'maths-level1':'L1 Maths',
    'maths-level2':'L2 Maths',
    'maths-level3':'L3 Maths',
    'english-year2':'Year 2 English',
    'english-year3':'Year 3 English',
    'english-year4':'Year 4 English',
    'english-year5':'Year 5 English',
    'english-year6':'Year 6 English',
    'english-year4-11plus':'Year 4 11+ English + VR',
    'english-year5-11plus':'Year 5 11+ English + VR'
  });

  let portalIdDirty = false;
  let currentCredentials = null;
  let loading = false;

  function status(text, kind='') {
    const el = $('trialStatus');
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

  function proposedId(name) {
    const clean = String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '');
    return clean ? `Trial${clean}`.slice(0, 40) : '';
  }

  function selectedViews() {
    return [...document.querySelectorAll('input[data-trial-view]:checked')]
      .map(input => input.dataset.trialView)
      .filter(Boolean);
  }

  function accessText(views) {
    return (Array.isArray(views) ? views : [])
      .map(viewId => VIEW_LABELS[viewId] || viewId)
      .join(', ');
  }

  function showCredentials(data, heading='Trial login created') {
    currentCredentials = {
      portalUserId:data.portalUserId,
      loginPassword:data.loginPassword,
      answerPassword:data.answerPassword,
      trialViews:data.trialViews || []
    };
    $('trialResultTitle').textContent = heading;
    $('trialResultUser').textContent = data.portalUserId || '';
    $('trialResultLogin').textContent = data.loginPassword || '';
    $('trialResultAnswer').textContent = data.answerPassword || '';
    $('trialResultAccess').textContent = accessText(data.trialViews || []);
    $('trialCredentialBox').classList.remove('hidden');
  }

  function hideCredentials() {
    currentCredentials = null;
    $('trialCredentialBox')?.classList.add('hidden');
  }

  async function copyCredentials() {
    if (!currentCredentials) return;
    const text = [
      'Future Perfect Portal Trial Login',
      `Username: ${currentCredentials.portalUserId}`,
      `Password: ${currentCredentials.loginPassword}`,
      `Answer Pack password: ${currentCredentials.answerPassword}`,
      `Access: ${accessText(currentCredentials.trialViews)}`
    ].join('\n');
    await navigator.clipboard.writeText(text);
    status('Trial login details copied to the clipboard.', 'good');
  }

  function stateText(trial) {
    if (!trial.active) return 'Disabled';
    if (trial.oneLoginUnused) return 'Unused — 1 login available';
    return trial.consumedAt ? `Used ${new Date(trial.consumedAt).toLocaleString()}` : 'Used';
  }

  function ensurePasswordColumns() {
    const body = $('trialListBody');
    const headerRow = body?.closest('table')?.querySelector('thead tr');
    if (!body || !headerRow) return;

    const headers = [...headerRow.children].map(cell => cell.textContent.trim());
    if (!headers.includes('Login Password')) {
      const accessHeader = [...headerRow.children].find(cell => cell.textContent.trim() === 'Access');
      if (accessHeader) {
        const loginHeader = document.createElement('th');
        loginHeader.textContent = 'Login Password';
        const answerHeader = document.createElement('th');
        answerHeader.textContent = 'Answer Pack Password';
        headerRow.insertBefore(loginHeader, accessHeader);
        headerRow.insertBefore(answerHeader, accessHeader);
      }
    }

    for (const cell of body.querySelectorAll('td[colspan]')) cell.colSpan = 7;
  }

  function button(label, action, portalUserId, className='ghost') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.dataset.trialAction = action;
    el.dataset.portalUserId = portalUserId;
    el.textContent = label;
    return el;
  }

  function renderTrials(trials) {
    const body = $('trialListBody');
    if (!body) return;
    ensurePasswordColumns();
    body.innerHTML = '';
    if (!trials.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No Trial logins found.';
      td.className = 'muted';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (const trial of trials) {
      const tr = document.createElement('tr');
      const cells = [
        trial.portalUserId || '',
        trial.firstName || '',
        trial.loginPassword || '—',
        trial.answerPassword || '—',
        accessText(trial.trialViews || []),
        stateText(trial)
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      const actions = document.createElement('td');
      actions.className = 'trial-actions';
      actions.append(
        button('Re-arm', 'rearm', trial.portalUserId),
        button('Reset Passwords', 'reset-passwords', trial.portalUserId),
        button('Disable', 'disable', trial.portalUserId, 'danger')
      );
      tr.appendChild(actions);
      body.appendChild(tr);
    }
  }

  async function refreshTrials(silent=false) {
    if (loading) return;
    loading = true;
    $('refreshTrialsBtn').disabled = true;
    try {
      const data = await api('/api/v1/admin/trials/list');
      renderTrials(data.trials || []);
      if (!silent) status(`Loaded ${(data.trials || []).length} Trial login${(data.trials || []).length === 1 ? '' : 's'}.`, 'good');
    } catch (error) {
      if (!silent || error.code !== 'UNAUTHORISED') status(`Could not load Trial logins: ${error.message}`, 'bad');
    } finally {
      loading = false;
      $('refreshTrialsBtn').disabled = false;
    }
  }

  async function createTrial() {
    const firstName = $('trialFirstName').value.trim();
    const portalUserId = $('trialPortalId').value.trim();
    const trialViews = selectedViews();
    if (!firstName) return status('Enter the child’s first name.', 'bad');
    if (!portalUserId) return status('Enter or accept the proposed Trial ID.', 'bad');
    if (!trialViews.length) return status('Select at least one Maths or English access area.', 'bad');

    $('createTrialBtn').disabled = true;
    hideCredentials();
    status('Creating Trial login…', 'warn');
    try {
      const data = await api('/api/v1/admin/trials/create', { firstName, portalUserId, trialViews });
      showCredentials(data);
      status(`${data.portalUserId} is ready. The single Trial login is unused.`, 'good');
      await refreshTrials(true);
    } catch (error) {
      const message = error.code === 'ACCOUNT_ALREADY_EXISTS'
        ? 'That Trial ID already exists. Change the ID or use the existing account controls below.'
        : error.code === 'INVALID_TRIAL_ID'
          ? 'Trial IDs must begin with Trial and contain only letters, numbers, hyphens or underscores.'
          : `Could not create Trial login: ${error.message}`;
      status(message, 'bad');
    } finally {
      $('createTrialBtn').disabled = false;
    }
  }

  async function actionOnTrial(action, portalUserId) {
    const labels = {
      rearm:'give this Trial account one new login and revoke any active session',
      disable:'disable this Trial account and revoke any active session',
      'reset-passwords':'generate new login and Answer Pack passwords and revoke any active session'
    };
    if (!window.confirm(`Confirm: ${labels[action]}?`)) return;
    status(`Updating ${portalUserId}…`, 'warn');
    hideCredentials();
    try {
      if (action === 'rearm') {
        const data = await api('/api/v1/admin/trials/rearm', { portalUserId });
        status(`${portalUserId} has one unused Trial login again.`, 'good');
        await refreshTrials(true);
        return;
      }
      if (action === 'disable') {
        await api('/api/v1/admin/trials/disable', { portalUserId });
        status(`${portalUserId} is disabled.`, 'good');
        await refreshTrials(true);
        return;
      }
      const data = await api('/api/v1/admin/trials/reset-passwords', { portalUserId });
      showCredentials(data, 'Trial passwords reset');
      status(
        data.oneLoginUnused
          ? `Passwords reset for ${portalUserId}; its one Trial login is still unused.`
          : `Passwords reset for ${portalUserId}. Its Trial login has already been consumed; use Re-arm if another login is required.`,
        data.oneLoginUnused ? 'good' : 'warn'
      );
      await refreshTrials(true);
    } catch (error) {
      status(`Could not update ${portalUserId}: ${error.message}`, 'bad');
    }
  }

  $('trialFirstName')?.addEventListener('input', event => {
    if (!portalIdDirty) $('trialPortalId').value = proposedId(event.target.value);
  });
  $('trialPortalId')?.addEventListener('input', () => { portalIdDirty = true; });
  $('trialPortalIdReset')?.addEventListener('click', () => {
    portalIdDirty = false;
    $('trialPortalId').value = proposedId($('trialFirstName').value);
  });
  $('createTrialBtn')?.addEventListener('click', createTrial);
  $('refreshTrialsBtn')?.addEventListener('click', () => refreshTrials(false));
  $('copyTrialCredentialsBtn')?.addEventListener('click', copyCredentials);
  $('trialListBody')?.addEventListener('click', event => {
    const target = event.target.closest('button[data-trial-action]');
    if (!target) return;
    actionOnTrial(target.dataset.trialAction, target.dataset.portalUserId);
  });

  ensurePasswordColumns();

  // If an Admin token is already present from this page, quietly populate the
  // list. Otherwise the first Create/Refresh action will use the token issued by
  // the normal Admin sign-in above.
  if (localStorage.getItem(TOKEN_KEY)) refreshTrials(true);
})();