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
  let studentBatches = [];
  let studentBatchLabelByKey = new Map();
  let studentCredentials = null;

  function status(text, kind='') {
    const el = $('trialStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  function studentStatus(text, kind='') {
    const el = $('studentStatus');
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

  function proposedStudentId(name, dateOfBirth) {
    const cleanName = String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '');
    const date = String(dateOfBirth || '');
    if (!cleanName || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    return `${cleanName}${date.slice(8, 10)}${date.slice(5, 7)}`.slice(0, 40);
  }

  function todayLondon() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(new Date());
  }

  function selectedViews() {
    return [...document.querySelectorAll('input[data-trial-view]:checked')]
      .map(input => input.dataset.trialView)
      .filter(Boolean);
  }

  function selectedStudentBatches() {
    return [...document.querySelectorAll('input[data-student-batch]:checked')]
      .map(input => input.dataset.studentBatch)
      .filter(Boolean);
  }

  function accessText(views) {
    return (Array.isArray(views) ? views : [])
      .map(viewId => VIEW_LABELS[viewId] || viewId)
      .join(', ');
  }

  function batchDescription(batch) {
    const subject = String(batch?.subject || '').toLowerCase();
    const year = Number(batch?.schoolYear || 0);
    const stream = String(batch?.stream || '').toLowerCase();
    const level = Number(batch?.mathsLevel || 0);
    if (subject === 'maths' && stream === '11plus') return `L${level || Math.max(1, year - 3)} Maths 11+`;
    if (subject === 'english' && stream === '11plus') return `Year ${year} 11+ English`;
    return `Year ${year} ${subject === 'english' ? 'English' : 'Maths'}`;
  }

  function batchText(keys) {
    return (Array.isArray(keys) ? keys : [])
      .map(key => studentBatchLabelByKey.get(key) || key)
      .join(', ');
  }

  function installAdminLayout() {
    const home = $('adminToolsHome');
    const release = $('lessonReleaseSection');
    const grid = home?.querySelector('.admin-tools-grid');
    if (!home || !release || !grid) return;

    const releaseButton = grid.querySelector('[data-admin-target="lessonReleaseSection"]');
    const releaseCard = releaseButton?.closest('.admin-tool');
    if (releaseCard) grid.prepend(releaseCard);

    if (!$('studentAdminTool')) {
      const card = document.createElement('div');
      card.className = 'admin-tool';
      card.id = 'studentAdminTool';
      card.innerHTML = '<h3>Create Student Login</h3><p>Create a normal Portal user when a student joins, assign their current batch(es), and generate separate login and Answer Pack passwords.</p><button type="button" data-admin-target="studentManagerSection">Open Student Login Manager</button>';
      if (releaseCard) releaseCard.after(card);
      else grid.prepend(card);
    }

    home.after(release);

    if (!$('studentManagerSection')) {
      const section = document.createElement('section');
      section.className = 'admin-section';
      section.id = 'studentManagerSection';
      section.innerHTML = `
        <h2>Student Login Manager</h2>
        <p class="muted">Create a normal student Portal login immediately. The username is generated from first name + DDMM, the selected batch memberships start from the join date, and no past lesson entitlement is created automatically.</p>
        <div class="row">
          <div><label for="studentFirstName">Child first name</label><input id="studentFirstName" type="text" autocomplete="off" placeholder="Aarav"></div>
          <div><label for="studentDob">Date of birth</label><input id="studentDob" type="date" autocomplete="off"></div>
          <div><label for="studentPortalId">Portal username</label><input id="studentPortalId" type="text" autocomplete="off" readonly placeholder="Generated from name + DDMM"></div>
          <div><label for="studentJoinDate">Join date</label><input id="studentJoinDate" type="date" autocomplete="off"></div>
        </div>
        <div class="source-title" style="margin-top:18px">Current batch membership</div>
        <p class="muted" style="margin-top:4px">Select every batch the student is joining. These memberships determine the student’s Current views; lesson resources are still released by Lesson Release Import.</p>
        <div id="studentBatchChoices" class="trial-access-grid"><div class="muted">Loading active batches…</div></div>
        <div class="row"><button id="refreshStudentBatchesBtn" type="button" class="secondary">Refresh Active Batches</button><button id="createStudentBtn" type="button">Create Student Login</button></div>
        <div id="studentStatus" class="status hidden"></div>
        <div id="studentCredentialBox" class="trial-credential-box hidden">
          <div class="state-title">Student login created</div>
          <div class="credential-grid">
            <div>Username</div><div id="studentResultUser" class="credential-value"></div>
            <div>Login password</div><div id="studentResultLogin" class="credential-value"></div>
            <div>Answer Pack password</div><div id="studentResultAnswer" class="credential-value"></div>
            <div>Batch access</div><div id="studentResultBatches"></div>
          </div>
          <button id="copyStudentCredentialsBtn" type="button">Copy Details</button>
        </div>`;
      release.after(section);
    }

    if (!document.getElementById('adminAccountEnhancementStyles')) {
      const style = document.createElement('style');
      style.id = 'adminAccountEnhancementStyles';
      style.textContent = '#studentManagerSection input[type=date]{padding:10px;border:1px solid #b9c4d4;border-radius:9px;background:#fff;min-height:20px}#studentPortalId[readonly]{background:#f3f5f8;color:#344054}.student-batch-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700}.student-batch-meta{font-size:12px;color:#667085;margin-left:24px;margin-top:-4px}';
      document.head.appendChild(style);
    }

    grid.addEventListener('click', event => {
      const button = event.target.closest('button[data-admin-target]');
      if (!button) return;
      const target = document.getElementById(button.dataset.adminTarget || '');
      if (target) target.scrollIntoView({ behavior:'smooth', block:'start' });
    });
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

  function showStudentCredentials(data) {
    studentCredentials = {
      portalUserId:data.portalUserId,
      loginPassword:data.loginPassword,
      answerPassword:data.answerPassword,
      batchKeys:data.batchKeys || []
    };
    $('studentResultUser').textContent = data.portalUserId || '';
    $('studentResultLogin').textContent = data.loginPassword || '';
    $('studentResultAnswer').textContent = data.answerPassword || '';
    $('studentResultBatches').textContent = batchText(data.batchKeys || []);
    $('studentCredentialBox').classList.remove('hidden');
  }

  function hideStudentCredentials() {
    studentCredentials = null;
    $('studentCredentialBox')?.classList.add('hidden');
  }

  async function copyStudentCredentials() {
    if (!studentCredentials) return;
    const text = [
      'Future Perfect Portal Login',
      `Username: ${studentCredentials.portalUserId}`,
      `Password: ${studentCredentials.loginPassword}`,
      `Answer Pack password: ${studentCredentials.answerPassword}`,
      `Batches: ${batchText(studentCredentials.batchKeys)}`
    ].join('\n');
    await navigator.clipboard.writeText(text);
    studentStatus('Student login details copied to the clipboard.', 'good');
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
        button('Disable', 'disable', trial.portalUserId, 'danger'),
        button('Delete', 'delete', trial.portalUserId, 'danger')
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
      delete:'delete this Trial row, revoke any active session and remove it from Existing Trial logins',
      'reset-passwords':'generate new login and Answer Pack passwords and revoke any active session'
    };
    if (!window.confirm(`Confirm: ${labels[action]}?`)) return;
    status(`Updating ${portalUserId}…`, 'warn');
    hideCredentials();
    try {
      if (action === 'rearm') {
        await api('/api/v1/admin/trials/rearm', { portalUserId });
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
      if (action === 'delete') {
        await api('/api/v1/admin/trials/delete', { portalUserId });
        status(`${portalUserId} was deleted from Existing Trial logins.`, 'good');
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

  function renderStudentBatches(batches) {
    const container = $('studentBatchChoices');
    if (!container) return;
    studentBatches = Array.isArray(batches) ? batches : [];
    studentBatchLabelByKey = new Map();
    container.innerHTML = '';
    if (!studentBatches.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No active batches were found.';
      container.appendChild(empty);
      return;
    }

    const groups = new Map();
    for (const batch of studentBatches) {
      const year = Number(batch.schoolYear || 0);
      const subject = String(batch.subject || '').toLowerCase();
      const groupKey = `${year}|${subject}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(batch);
    }

    for (const [groupKey, rows] of groups) {
      const [year, subject] = groupKey.split('|');
      const group = document.createElement('div');
      group.className = 'trial-access-group';
      const heading = document.createElement('strong');
      heading.textContent = `Year ${year} ${subject === 'english' ? 'English' : 'Maths'}`;
      group.appendChild(heading);
      for (const batch of rows) {
        const labelText = `${batch.batchKey} — ${batchDescription(batch)}`;
        studentBatchLabelByKey.set(batch.batchKey, labelText);
        const label = document.createElement('label');
        label.className = 'checkline';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.studentBatch = batch.batchKey;
        const code = document.createElement('span');
        code.className = 'student-batch-code';
        code.textContent = batch.batchKey;
        const desc = document.createElement('span');
        desc.textContent = batchDescription(batch);
        label.append(input, code, desc);
        group.appendChild(label);
      }
      container.appendChild(group);
    }
  }

  async function refreshStudentBatches(silent=false) {
    const button = $('refreshStudentBatchesBtn');
    if (button) button.disabled = true;
    try {
      const data = await api('/api/v1/admin/students/batches');
      renderStudentBatches(data.batches || []);
      if (!silent) studentStatus(`Loaded ${(data.batches || []).length} active batch${(data.batches || []).length === 1 ? '' : 'es'}.`, 'good');
    } catch (error) {
      if (!silent || error.code !== 'UNAUTHORISED') studentStatus(`Could not load active batches: ${error.message}`, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function updateStudentPortalId() {
    if (!$('studentPortalId')) return;
    $('studentPortalId').value = proposedStudentId($('studentFirstName')?.value, $('studentDob')?.value);
  }

  async function createStudent() {
    const firstName = $('studentFirstName').value.trim();
    const dateOfBirth = $('studentDob').value;
    const joinDate = $('studentJoinDate').value;
    const batchKeys = selectedStudentBatches();
    const portalUserId = proposedStudentId(firstName, dateOfBirth);

    if (!firstName) return studentStatus('Enter the child’s first name.', 'bad');
    if (!dateOfBirth) return studentStatus('Enter the child’s date of birth so the Portal username can be generated.', 'bad');
    if (!joinDate) return studentStatus('Enter the student’s join date.', 'bad');
    if (!portalUserId) return studentStatus('The Portal username could not be generated from the name and date of birth.', 'bad');
    if (!batchKeys.length) return studentStatus('Select at least one current batch.', 'bad');

    $('createStudentBtn').disabled = true;
    hideStudentCredentials();
    studentStatus(`Creating ${portalUserId}…`, 'warn');
    try {
      const data = await api('/api/v1/admin/students/create', {
        firstName,
        dateOfBirth,
        joinDate,
        batchKeys
      });
      showStudentCredentials(data);
      studentStatus(`${data.portalUserId} is ready and assigned to ${data.batchKeys.length} batch${data.batchKeys.length === 1 ? '' : 'es'} from ${data.joinDate}.`, 'good');
    } catch (error) {
      let message = `Could not create student login: ${error.message}`;
      if (error.code === 'ACCOUNT_ALREADY_EXISTS') message = `A Portal account named ${portalUserId} already exists. Check the child’s details before creating another account.`;
      else if (error.code === 'BATCH_NOT_ACTIVE_ON_JOIN_DATE') message = `One or more selected batches were not active on the join date: ${(error.data?.batches || []).join(', ')}.`;
      else if (error.code === 'INVALID_BATCH') message = 'One or more selected batches no longer exist. Refresh Active Batches and try again.';
      else if (error.code === 'READ_MODEL_RECONCILIATION_NOT_READY') message = 'Student access synchronisation is temporarily unavailable. Nothing was created; try again shortly.';
      studentStatus(message, 'bad');
    } finally {
      $('createStudentBtn').disabled = false;
    }
  }

  installAdminLayout();

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

  $('studentFirstName')?.addEventListener('input', updateStudentPortalId);
  $('studentDob')?.addEventListener('change', updateStudentPortalId);
  $('studentDob')?.addEventListener('input', updateStudentPortalId);
  $('studentJoinDate').value = todayLondon();
  $('refreshStudentBatchesBtn')?.addEventListener('click', () => refreshStudentBatches(false));
  $('createStudentBtn')?.addEventListener('click', createStudent);
  $('copyStudentCredentialsBtn')?.addEventListener('click', copyStudentCredentials);

  ensurePasswordColumns();

  // If an Admin token is already present from this page, quietly populate both
  // account-management surfaces. Otherwise the first action will use the token
  // issued by the normal Admin sign-in above.
  if (localStorage.getItem(TOKEN_KEY)) {
    refreshTrials(true);
    refreshStudentBatches(true);
  }
})();