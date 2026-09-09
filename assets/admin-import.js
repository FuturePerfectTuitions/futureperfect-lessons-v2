(() => {
  const worker = document.querySelector('meta[name="fpt-worker-base"]').content.replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  const sourceApi = window.FPTAdminCsvSource || null;
  const TOKEN_KEY = 'fptAdminImportToken';

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let rows = [];
  let savedDirectory = null;
  let processing = false;
  let sourceInitialised = false;

  function setStatus(el, text, kind='') {
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  function setMainStatus(title, text, kind='', state='idle') {
    const el = $('status');
    el.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'state-title';
    heading.textContent = title;
    const detail = document.createElement('div');
    detail.textContent = text;
    el.append(heading, detail);
    el.className = `status ${kind}`.trim();
    document.body.dataset.importState = state;
  }

  function setControlsDisabled(disabled) {
    $('setSourceBtn').disabled = disabled;
    $('loadLatestBtn').disabled = disabled || !savedDirectory;
    $('clearSourceBtn').disabled = disabled || !savedDirectory;
    $('csvFile').disabled = disabled;
    $('processSelectedBtn').disabled = disabled || !rows.length;
  }

  function resetResults() {
    $('tableWrap').classList.add('hidden');
    $('summary').innerHTML = '';
  }

  function showLogin() {
    $('importCard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('password').focus();
  }

  async function showImport() {
    $('loginCard').classList.add('hidden');
    $('importCard').classList.remove('hidden');
    if (!sourceInitialised) {
      sourceInitialised = true;
      await initSavedSource();
    }
  }

  async function api(path, body, auth=true) {
    const headers = { 'content-type':'application/json' };
    if (auth && token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${worker}${path}`, {
      method:'POST',
      headers,
      body:JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (response.status === 401 && auth) {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      sourceInitialised = false;
      showLogin();
    }
    if (!response.ok || data.ok === false) {
      throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { data });
    }
    return data;
  }

  function parseCsv(text) {
    const out=[]; let row=[], field='', quoted=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i];
      if (quoted) {
        if (c==='"' && text[i+1]==='"') { field+='"'; i++; }
        else if (c==='"') quoted=false;
        else field+=c;
      } else {
        if (c==='"') quoted=true;
        else if (c===',') { row.push(field); field=''; }
        else if (c==='\n') { row.push(field.replace(/\r$/,'')); out.push(row); row=[]; field=''; }
        else field+=c;
      }
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/,'')); out.push(row); }
    const nonblank=out.filter(r => r.some(v => String(v).trim()!==''));
    if (!nonblank.length) return [];
    const headers=nonblank[0].map((h,i)=>String(h).replace(/^\uFEFF/,'').trim() || `Column${i+1}`);
    return nonblank.slice(1).map(r => Object.fromEntries(headers.map((h,i)=>[h,r[i] ?? ''])));
  }

  function loadRows(text, sourceLabel='CSV') {
    resetResults();
    rows=parseCsv(text);
    const required=['Student','Name','Year','Subject','Mode','Lesson','LessonDated','LessonStatus','Remarks','Email','Parent'];
    const keys=new Set(Object.keys(rows[0] || {}).map(k=>k.toLowerCase()));
    const missing=required.filter(k=>!keys.has(k.toLowerCase()));
    if (!rows.length) throw new Error('CSV contains no data rows.');
    if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}`);
    $('processSelectedBtn').disabled=false;
    setMainStatus('CSV LOADED', `${rows.length} row${rows.length===1?'':'s'} loaded from ${sourceLabel}. Validation is starting automatically.`, 'warn', 'loaded');
  }

  function renderSummary(summary) {
    $('summary').innerHTML='';
    for (const [k,v] of Object.entries(summary || {})) {
      const span=document.createElement('span');
      span.className='pill';
      span.textContent=`${k}: ${v}`;
      $('summary').appendChild(span);
    }
  }

  function render(results, summary) {
    renderSummary(summary);
    $('resultBody').innerHTML='';
    for (const r of results || []) {
      const tr=document.createElement('tr');
      const emailAction=r.emailAction || r.emailType || 'None';
      const vals=[
        Number.isInteger(r.index) ? r.index+2 : '',
        r.portalUserId,
        r.name,
        r.parent,
        r.parentEmail,
        r.batchKey,
        r.lessonLabel || r.lessonId,
        r.lessonDateDisplay || r.lessonDate,
        r.lessonStatus,
        r.releaseType,
        r.action || r.status,
        emailAction,
        r.message || ''
      ];
      vals.forEach((v,i)=>{
        const td=document.createElement('td');
        td.textContent=v ?? '';
        if(i===10) td.className=r.ok===false?'err':'ok';
        if(i===11 && r.emailType) td.className=r.ok===false?'err':'ok';
        tr.appendChild(td);
      });
      $('resultBody').appendChild(tr);
    }
    $('tableWrap').classList.remove('hidden');
  }

  async function processCurrentRows() {
    if (processing || !rows.length) return;
    processing = true;
    setControlsDisabled(true);
    setMainStatus('VALIDATING', 'Checking Portal access, lesson data and parent email actions. Nothing has been changed or sent yet.', 'warn', 'validating');

    try {
      const preview=await api('/api/v1/admin/lesson-releases/preview',{ rows });
      render(preview.results,preview.summary);

      const errors=Number(preview.summary?.errors || 0);
      const releasable=Number(preview.summary?.releasable || 0);
      const emailEligible=Number(preview.summary?.emailEligible || 0);

      if (errors) {
        setMainStatus('IMPORT FAILED', `Validation found ${errors} error${errors===1?'':'s'}. Nothing has been changed or sent. Correct the CSV source and run it again.`, 'bad', 'failed');
        return;
      }

      if (!releasable && !emailEligible) {
        setMainStatus('IMPORT COMPLETE', 'Validation passed. There were no Portal release actions or parent emails to process.', 'good', 'complete');
        return;
      }

      setMainStatus('PROCESSING', `Validation passed. Applying ${releasable} Portal action${releasable===1?'':'s'} and processing ${emailEligible} parent email${emailEligible===1?'':'s'} now.`, 'warn', 'processing');
      const data=await api('/api/v1/admin/lesson-releases/confirm',{ rows });
      renderSummary(data.summary);

      const portalFailed=Number(data.summary?.failed || 0);
      const portalSucceeded=Number(data.summary?.succeeded || 0);
      const emailsSent=Number(data.summary?.emailsSent || 0);
      const emailsFailed=Number(data.summary?.emailsFailed || 0);
      const emailsAlreadySent=Number(data.summary?.emailsAlreadySent || 0);
      const failedEmailResults=(data.emailResults || []).filter(r=>!r.ok && r.status!=='ALREADY_SENT');
      const failedAddresses=failedEmailResults.map(r=>r.parentEmail).filter(Boolean);
      const failureMessages=[...new Set(failedEmailResults.map(r=>r.message || r.status).filter(Boolean))];

      if (portalFailed || emailsFailed) {
        const detail=failedAddresses.length ? ` Failed email recipient${failedAddresses.length===1?'':'s'}: ${failedAddresses.join(', ')}.` : '';
        const reason=failureMessages.length ? ` Email error: ${failureMessages.join(' | ')}` : '';
        setMainStatus('IMPORT FAILED', `Processing finished with ${portalFailed} Portal failure${portalFailed===1?'':'s'} and ${emailsFailed} email failure${emailsFailed===1?'':'s'}. Successful actions were kept.${detail}${reason}`, 'bad', 'failed');
      } else {
        const duplicateNote=emailsAlreadySent ? ` ${emailsAlreadySent} previously sent email${emailsAlreadySent===1?' was':'s were'} safely skipped.` : '';
        setMainStatus('IMPORT COMPLETE', `${portalSucceeded} Portal action${portalSucceeded===1?'':'s'} confirmed and ${emailsSent} parent email${emailsSent===1?'':'s'} sent.${duplicateNote}`, 'good', 'complete');
      }
    } catch(e) {
      if (e.data?.results) render(e.data.results,{ errors:e.data.results.filter(r=>!r.ok).length });
      if (e.data?.error === 'VALIDATION_FAILED') {
        setMainStatus('IMPORT FAILED', 'Revalidation failed immediately before processing. No new release actions were applied and no new emails were sent.', 'bad', 'failed');
      } else if (e.data?.error !== 'UNAUTHORISED') {
        setMainStatus('IMPORT FAILED', `Import failed: ${e.message}`, 'bad', 'failed');
      }
    } finally {
      processing = false;
      setControlsDisabled(false);
    }
  }

  async function loadLatestAndProcess(requestPermission=true) {
    if (!savedDirectory) throw new Error('Set the CSV source folder first.');
    setControlsDisabled(true);
    setStatus($('sourceStatus'),'Reading the current workFP.csv from the saved folder…','warn');
    try {
      const loaded=await sourceApi.readLatestCsv(savedDirectory,requestPermission);
      const time=loaded.lastModified ? new Date(loaded.lastModified).toLocaleString() : '';
      $('sourceMeta').textContent=`Saved folder: ${loaded.directoryName} • File: ${loaded.name}${time ? ` • Modified: ${time}` : ''}`;
      loadRows(loaded.text,loaded.name);
      setStatus($('sourceStatus'),`${loaded.name} loaded. The automatic import is running.`,'good');
      await processCurrentRows();
    } catch(e) {
      if (/permission/i.test(e.message || '')) {
        document.body.dataset.importState='needs-permission';
        setStatus($('sourceStatus'),'Chrome needs permission to read the saved CSV folder. Click Process Latest CSV once to grant access; subsequent imports will run automatically while that permission remains granted.','warn');
      } else {
        setStatus($('sourceStatus'),e.message || 'Could not read the saved CSV source.','bad');
        setMainStatus('IMPORT FAILED', e.message || 'Could not read the saved CSV source.', 'bad', 'failed');
      }
    } finally {
      setControlsDisabled(false);
    }
  }

  async function initSavedSource() {
    if (!sourceApi?.supported?.()) {
      $('savedSourceBox').classList.add('hidden');
      setMainStatus('CSV SOURCE REQUIRED', 'This browser cannot use the saved-folder workflow. Choose the CSV manually below.', 'warn', 'needs-source');
      return;
    }

    $('savedSourceBox').classList.remove('hidden');
    try {
      savedDirectory=await sourceApi.getSavedDirectory();
      if (!savedDirectory) {
        $('sourceMeta').textContent='No folder has been saved yet. Choose the folder containing workFP.csv once; Chrome will remember the folder handle.';
        $('loadLatestBtn').disabled=true;
        $('clearSourceBtn').disabled=true;
        setMainStatus('CSV SOURCE REQUIRED', 'Set the CSV Source Folder once. After that, opening this page can process the latest workFP.csv automatically.', 'warn', 'needs-source');
        return;
      }

      $('sourceMeta').textContent=`Saved folder: ${savedDirectory.name}. Checking permission…`;
      $('clearSourceBtn').disabled=false;

      const permissionFromLogin=await Promise.resolve(window.FPTAdminSourcePermissionReady).catch(()=>false);
      const granted=permissionFromLogin || await sourceApi.permission(savedDirectory,false).catch(()=>false);
      $('loadLatestBtn').disabled=false;

      if (granted) {
        await loadLatestAndProcess(false);
      } else {
        document.body.dataset.importState='needs-permission';
        setStatus($('sourceStatus'),'Saved folder found. Chrome requires one click to renew read permission.','warn');
        setMainStatus('FOLDER PERMISSION REQUIRED', 'Click Process Latest CSV once. No AHK or keyboard automation is required.', 'warn', 'needs-permission');
      }
    } catch(e) {
      savedDirectory=null;
      $('sourceMeta').textContent='The saved CSV source could not be restored. Choose the folder again or use the manual CSV fallback.';
      $('loadLatestBtn').disabled=true;
      $('clearSourceBtn').disabled=true;
      setMainStatus('CSV SOURCE REQUIRED', 'The saved folder could not be restored.', 'bad', 'needs-source');
    }
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('loginBtn').disabled=true;
    try {
      const data=await api('/api/v1/admin/lesson-releases/login',{ password:$('password').value },false);
      token=data.token;
      localStorage.setItem(TOKEN_KEY,token);
      $('password').value='';
      await Promise.resolve(window.FPTAdminSourcePermissionReady).catch(()=>false);
      await showImport();
    } catch(e) {
      setStatus($('loginStatus'), e.data?.error==='ADMIN_IMPORT_NOT_CONFIGURED' ? 'Admin import has not yet been configured on the Worker.' : 'Sign-in failed.', 'bad');
    } finally {
      $('loginBtn').disabled=false;
    }
  });

  $('setSourceBtn').addEventListener('click', async () => {
    if (!sourceApi?.supported?.() || processing) return;
    $('setSourceBtn').disabled=true;
    try {
      savedDirectory=await sourceApi.chooseDirectory();
      $('sourceMeta').textContent=`Saved folder: ${savedDirectory.name}. Looking for workFP.csv…`;
      $('clearSourceBtn').disabled=false;
      $('loadLatestBtn').disabled=false;
      await loadLatestAndProcess(false);
    } catch(e) {
      if (e?.name !== 'AbortError') setStatus($('sourceStatus'),e.message || 'Could not save the CSV source folder.','bad');
    } finally {
      $('setSourceBtn').disabled=false;
    }
  });

  $('loadLatestBtn').addEventListener('click', () => loadLatestAndProcess(true));

  $('clearSourceBtn').addEventListener('click', async () => {
    if (processing) return;
    try { await sourceApi.clearSavedDirectory(); } catch { /* UI still clears local handle */ }
    savedDirectory=null;
    rows=[];
    $('loadLatestBtn').disabled=true;
    $('clearSourceBtn').disabled=true;
    $('processSelectedBtn').disabled=true;
    $('sourceMeta').textContent='No folder saved. Use Set CSV Source Folder to choose the folder containing workFP.csv.';
    setStatus($('sourceStatus'),'Saved CSV source forgotten. Manual upload remains available.','good');
    setMainStatus('CSV SOURCE REQUIRED', 'Set the CSV Source Folder or choose a CSV manually.', 'warn', 'needs-source');
  });

  $('csvFile').addEventListener('change', async () => {
    resetResults();
    const file=$('csvFile').files[0];
    if (!file) { rows=[]; $('processSelectedBtn').disabled=true; return; }
    try {
      loadRows(await file.text(),file.name);
      setMainStatus('CSV READY', `${file.name} is ready. Click Process Selected CSV; there is no additional confirmation after validation.`, 'warn', 'loaded');
    } catch(e) {
      rows=[];
      $('processSelectedBtn').disabled=true;
      setMainStatus('IMPORT FAILED',e.message,'bad','failed');
    }
  });

  $('processSelectedBtn').addEventListener('click', processCurrentRows);

  if (token) showImport();
  else showLogin();
})();
