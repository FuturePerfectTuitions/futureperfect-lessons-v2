(() => {
  const worker = document.querySelector('meta[name="fpt-worker-base"]').content.replace(/\/$/, '');
  const TOKEN_KEY = 'fptAdminImportToken';
  const state = {
    rows:[],
    previewSummary:null,
    importSummary:null,
    sending:false
  };

  const originalFetch = window.fetch.bind(window);

  function requestBody(args) {
    try {
      const options = args[1] || {};
      if (!options.body) return null;
      return JSON.parse(options.body);
    } catch {
      return null;
    }
  }

  function requestUrl(args) {
    try {
      const first = args[0];
      return typeof first === 'string' ? first : first?.url || '';
    } catch {
      return '';
    }
  }

  window.fetch = async (...args) => {
    const url = requestUrl(args);
    const body = requestBody(args);
    if (Array.isArray(body?.rows)) state.rows = body.rows;

    const response = await originalFetch(...args);

    if (url.includes('/api/v1/admin/lesson-releases/preview')) {
      response.clone().json().then(data => {
        if (data?.ok) state.previewSummary = data.summary || null;
      }).catch(() => null);
    }

    if (url.includes('/api/v1/admin/lesson-releases/confirm') && body?.sendEmails !== true) {
      response.clone().json().then(data => {
        if (data?.ok) {
          state.importSummary = data.summary || null;
          setTimeout(updateAfterImport, 0);
        }
      }).catch(() => null);
    }

    return response;
  };

  function statusElement() {
    return document.getElementById('status');
  }

  function sendButton() {
    return document.getElementById('sendEmailsBtn');
  }

  function setStatus(title, text, kind='') {
    const el = statusElement();
    if (!el) return;
    el.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'state-title';
    heading.textContent = title;
    const detail = document.createElement('div');
    detail.textContent = text;
    el.append(heading, detail);
    el.className = `status ${kind}`.trim();
  }

  function eligibleCount() {
    return Number(
      state.importSummary?.emailEligible ??
      state.importSummary?.emailsEligible ??
      state.previewSummary?.emailEligible ??
      0
    );
  }

  function updateAfterImport() {
    const button = sendButton();
    const count = eligibleCount();
    const portalFailed = Number(state.importSummary?.failed || 0);
    const portalSucceeded = Number(state.importSummary?.succeeded || 0);

    if (portalFailed) {
      if (button) button.disabled = true;
      return;
    }

    if (button) button.disabled = count < 1 || !state.rows.length;
    const emailText = count
      ? `${count} parent email${count === 1 ? ' is' : 's are'} ready. They have NOT been sent. Click Send Parent Emails when you are ready.`
      : 'There are no qualifying parent emails in this CSV.';
    setStatus(
      'IMPORT COMPLETE',
      `${portalSucceeded} Portal action${portalSucceeded === 1 ? '' : 's'} imported. ${emailText}`,
      'good'
    );
    document.body.dataset.importState = 'imported';
  }

  async function sendEmailsManually() {
    const button = sendButton();
    if (!button || state.sending || !state.rows.length) return;

    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) {
      setStatus('EMAILS NOT SENT', 'The admin session has expired. Sign in again before sending emails.', 'bad');
      return;
    }

    state.sending = true;
    button.disabled = true;
    setStatus('SENDING EMAILS', 'Parent emails are being sent now. Portal access was already imported.', 'warn');

    try {
      const response = await originalFetch(`${worker}/api/v1/admin/lesson-releases/confirm`, {
        method:'POST',
        headers:{
          'content-type':'application/json',
          authorization:`Bearer ${token}`
        },
        body:JSON.stringify({ rows:state.rows, sendEmails:true })
      });
      const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
      if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { data });

      const sent = Number(data.summary?.emailsSent || 0);
      const already = Number(data.summary?.emailsAlreadySent || 0);
      const failed = Number(data.summary?.emailsFailed || 0);

      if (failed) {
        button.disabled = false;
        setStatus(
          'EMAIL SEND INCOMPLETE',
          `${sent} email${sent === 1 ? '' : 's'} sent, ${already} already-sent duplicate${already === 1 ? '' : 's'} skipped, and ${failed} email${failed === 1 ? '' : 's'} failed. Review the result before retrying.`,
          'bad'
        );
        document.body.dataset.importState = 'email-failed';
      } else {
        setStatus(
          'EMAILS SENT',
          `${sent} parent email${sent === 1 ? '' : 's'} sent.${already ? ` ${already} previously sent duplicate${already === 1 ? ' was' : 's were'} safely skipped.` : ''}`,
          'good'
        );
        document.body.dataset.importState = 'emails-sent';
      }
    } catch (error) {
      button.disabled = false;
      setStatus('EMAILS NOT SENT', `Email sending failed: ${error.message}`, 'bad');
      document.body.dataset.importState = 'email-failed';
    } finally {
      state.sending = false;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const button = sendButton();
    if (button) button.addEventListener('click', sendEmailsManually);
  });
})();
