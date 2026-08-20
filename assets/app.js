(() => {
  const config = window.FPT_V2_CONFIG || {};
  const button = document.getElementById('test-worker');
  const status = document.getElementById('worker-status');
  const detail = document.getElementById('worker-detail');
  const output = document.getElementById('api-output');

  function setState(kind, headline, message) {
    status.className = kind;
    status.textContent = headline;
    detail.textContent = message;
  }

  async function testWorker() {
    const base = String(config.workerBaseUrl || '').replace(/\/$/, '');

    if (!base) {
      setState('status-wait', 'Not configured', 'Add the V2 Worker URL to config.js after the Worker is deployed.');
      output.textContent = 'workerBaseUrl is currently blank.';
      return;
    }

    button.disabled = true;
    setState('status-wait', 'Testing…', 'Calling the V2 Worker health endpoint.');
    output.textContent = `GET ${base}/api/health`;

    try {
      const response = await fetch(`${base}/api/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });

      const text = await response.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}

      output.textContent = `HTTP ${response.status}\n${body}`;

      if (!response.ok) {
        setState('status-error', 'Worker responded with an error', `HTTP ${response.status}`);
        return;
      }

      setState('status-ok', 'Connected', 'GitHub Pages can reach the V2 Worker.');
    } catch (error) {
      output.textContent = String(error && error.message ? error.message : error);
      setState('status-error', 'Connection failed', 'Check the Worker URL and allowed development origin.');
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', testWorker);

  if (config.workerBaseUrl) {
    setState('status-wait', 'Ready to test', 'The V2 Worker URL is configured.');
  }
})();
