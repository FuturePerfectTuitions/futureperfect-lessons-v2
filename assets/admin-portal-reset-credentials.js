(() => {
  const workerMeta = document.querySelector('meta[name="fpt-worker-base"]');
  if (!workerMeta) return;
  const worker = workerMeta.content.replace(/\/$/, '');
  const TOKEN_KEY = 'fptAdminImportToken';
  const $ = id => document.getElementById(id);

  async function api(path, body={}) {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) throw Object.assign(new Error('Sign in to Admin first.'), { code:'UNAUTHORISED' });
    const response = await fetch(`${worker}${path}`, {
      method:'POST',
      headers:{ 'content-type':'application/json', authorization:`Bearer ${token}` },
      body:JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.code = data.error || '';
      throw error;
    }
    return data;
  }

  function setStatus(text, kind='') {
    const el = $('portalLookupStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  function install() {
    const result = $('portalLookupResult');
    if (!result || $('portalResetCredentialsBtn')) return Boolean(result);
    const button = document.createElement('button');
    button.id = 'portalResetCredentialsBtn';
    button.type = 'button';
    button.className = 'danger';
    button.textContent = 'Reset & Show New Credentials';
    result.appendChild(button);

    button.addEventListener('click', async () => {
      const portalUserId = String($('portalLookupUsername')?.textContent || $('portalLookupId')?.value || '').trim();
      if (!portalUserId) return setStatus('Find the Portal account first.', 'bad');
      if (!window.confirm(`Reset both passwords for ${portalUserId}? The current passwords will be replaced.`)) return;
      button.disabled = true;
      setStatus(`Resetting credentials for ${portalUserId}…`, 'warn');
      try {
        const data = await api('/api/v1/admin/students/reset-credentials', { portalUserId });
        $('portalLookupLoginStored').textContent = data.loginPassword || '—';
        $('portalLookupAnswerStored').textContent = data.answerPassword || '—';
        setStatus('New credentials created and shown below. Batches, entitlements and account state were not changed.', 'good');
      } catch (error) {
        if (error.code === 'ACCOUNT_NOT_RESETTABLE_HERE') setStatus('Use the dedicated Trial/Admin account controls for this ID.', 'bad');
        else if (error.code === 'UNAUTHORISED') setStatus('Sign in to Admin again.', 'bad');
        else setStatus(`Could not reset credentials: ${error.message}`, 'bad');
      } finally {
        button.disabled = false;
      }
    });
    return true;
  }

  if (install()) return;
  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.body, { childList:true, subtree:true });
})();
