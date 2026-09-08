(() => {
  const worker = document.querySelector('meta[name="fpt-worker-base"]').content.replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  let token = sessionStorage.getItem('fptAdminImportToken') || '';
  let rows = [];

  function setStatus(el, text, kind='') {
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }
  function showImport() {
    $('loginCard').classList.add('hidden');
    $('importCard').classList.remove('hidden');
  }
  if (token) showImport();

  async function api(path, body, auth=true) {
    const headers = { 'content-type':'application/json' };
    if (auth && token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${worker}${path}`, { method:'POST', headers, body:JSON.stringify(body) });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (response.status === 401 && auth) {
      token=''; sessionStorage.removeItem('fptAdminImportToken');
      $('importCard').classList.add('hidden'); $('loginCard').classList.remove('hidden');
    }
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { data });
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
    for (const r of results) {
      const tr=document.createElement('tr');
      const emailAction=r.emailAction || r.emailType || 'None';
      const vals=[
        r.index+2,
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

  $('loginBtn').addEventListener('click', async () => {
    $('loginBtn').disabled=true;
    try {
      const data=await api('/api/v1/admin/lesson-releases/login',{ password:$('password').value },false);
      token=data.token; sessionStorage.setItem('fptAdminImportToken',token); $('password').value=''; showImport();
    } catch(e) { setStatus($('loginStatus'), e.data?.error==='ADMIN_IMPORT_NOT_CONFIGURED' ? 'Admin import has not yet been configured on the Worker.' : 'Sign-in failed.', 'bad'); }
    finally { $('loginBtn').disabled=false; }
  });

  $('csvFile').addEventListener('change', async () => {
    $('confirmBtn').disabled=true; $('tableWrap').classList.add('hidden'); $('summary').innerHTML='';
    const file=$('csvFile').files[0];
    if (!file) { $('previewBtn').disabled=true; return; }
    try {
      rows=parseCsv(await file.text());
      const required=['Student','Name','Year','Subject','Mode','Lesson','LessonDated','LessonStatus','Remarks','Email','Parent'];
      const keys=new Set(Object.keys(rows[0] || {}).map(k=>k.toLowerCase()));
      const missing=required.filter(k=>!keys.has(k.toLowerCase()));
      if (!rows.length) throw new Error('CSV contains no data rows.');
      if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}`);
      $('previewBtn').disabled=false;
      setStatus($('status'),`${rows.length} CSV row${rows.length===1?'':'s'} loaded. No Portal access has been changed and no emails have been sent.`,'good');
    } catch(e) { rows=[]; $('previewBtn').disabled=true; setStatus($('status'),e.message,'bad'); }
  });

  $('previewBtn').addEventListener('click', async () => {
    $('previewBtn').disabled=true; $('confirmBtn').disabled=true;
    setStatus($('status'),'Validating Portal access and parent email actions…','warn');
    try {
      const data=await api('/api/v1/admin/lesson-releases/preview',{ rows });
      render(data.results,data.summary);
      const errors=Number(data.summary?.errors || 0);
      const releasable=Number(data.summary?.releasable || 0);
      const emailEligible=Number(data.summary?.emailEligible || 0);
      if (errors) {
        setStatus($('status'),`Preview found ${errors} validation error${errors===1?'':'s'}. Nothing has been changed or sent. Fix the source data before importing.`,'bad');
      } else if (!releasable && !emailEligible) {
        setStatus($('status'),'Validation passed, but there is no Portal release or parent email action in these rows.','good');
      } else {
        setStatus($('status'),`Validation passed. Review the table, then confirm ${releasable} Portal release action${releasable===1?'':'s'} and ${emailEligible} parent email${emailEligible===1?'':'s'}.`,'good');
        $('confirmBtn').disabled=false;
      }
    } catch(e) { setStatus($('status'),`Preview failed: ${e.message}`,'bad'); }
    finally { $('previewBtn').disabled=false; }
  });

  $('confirmBtn').addEventListener('click', async () => {
    if (!window.confirm('Apply the validated Portal lesson releases and send the listed parent emails now?')) return;
    $('confirmBtn').disabled=true; $('previewBtn').disabled=true;
    setStatus($('status'),'Revalidating, applying Portal releases, then sending parent emails…','warn');
    try {
      const data=await api('/api/v1/admin/lesson-releases/confirm',{ rows });
      renderSummary(data.summary);
      const portalFailed=Number(data.summary?.failed || 0);
      const portalSucceeded=Number(data.summary?.succeeded || 0);
      const emailsSent=Number(data.summary?.emailsSent || 0);
      const emailsFailed=Number(data.summary?.emailsFailed || 0);
      const failedAddresses=(data.emailResults || []).filter(r=>!r.ok).map(r=>r.parentEmail).filter(Boolean);
      if (portalFailed || emailsFailed) {
        const detail=failedAddresses.length ? ` Failed email recipient${failedAddresses.length===1?'':'s'}: ${failedAddresses.join(', ')}.` : '';
        setStatus($('status'),`Import finished with ${portalFailed} Portal failure${portalFailed===1?'':'s'} and ${emailsFailed} email failure${emailsFailed===1?'':'s'}. Successful Portal changes were kept.${detail}`,'bad');
      } else {
        setStatus($('status'),`Import complete. ${portalSucceeded} Portal release action${portalSucceeded===1?'':'s'} confirmed and ${emailsSent} parent email${emailsSent===1?'':'s'} sent.`,'good');
      }
    } catch(e) {
      if (e.data?.results) render(e.data.results,{ errors:e.data.results.filter(r=>!r.ok).length });
      setStatus($('status'), e.data?.error==='VALIDATION_FAILED' ? 'Import stopped because revalidation failed. No release actions were applied and no emails were sent.' : `Import failed: ${e.message}`,'bad');
    } finally { $('previewBtn').disabled=false; }
  });
})();
