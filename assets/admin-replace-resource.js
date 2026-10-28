(() => {
  const workerMeta = document.querySelector('meta[name="fpt-worker-base"]');
  if (!workerMeta) return;
  const worker = workerMeta.content.replace(/\/$/, '');
  const TOKEN_KEY = 'fptAdminImportToken';
  const $ = id => document.getElementById(id);

  let loadedLesson = null;
  let resources = [];
  let replacing = false;
  const CONSISTENCY_MARKER = 'replace-resource-consistency-v1';

  function setStatus(text, kind='') {
    const el = $('replaceResourceStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `status ${kind}`.trim();
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  async function jsonApi(path, body) {
    const auth = token();
    if (!auth) throw Object.assign(new Error('Sign in to Admin first.'), { code:'UNAUTHORISED' });
    const response = await fetch(`${worker}${path}`, {
      method:'POST',
      headers:{ 'content-type':'application/json', authorization:`Bearer ${auth}` },
      body:JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.code = data.error || '';
      error.data = data;
      throw error;
    }
    return data;
  }

  async function formApi(path, form) {
    const auth = token();
    if (!auth) throw Object.assign(new Error('Sign in to Admin first.'), { code:'UNAUTHORISED' });
    const response = await fetch(`${worker}${path}`, {
      method:'POST',
      headers:{ authorization:`Bearer ${auth}` },
      body:form
    });
    const data = await response.json().catch(() => ({ ok:false, error:'INVALID_RESPONSE' }));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.code = data.error || '';
      error.data = data;
      throw error;
    }
    return data;
  }

  function basename(key) {
    const parts = String(key || '').split('/');
    return parts[parts.length - 1] || '';
  }

  function clearVerification() {
    $('replacePublicationVerification')?.classList.add('hidden');
  }

  function showVerification({ canonical, prepared, r2, currentFile, displayName }) {
    $('replaceCanonicalVerification').textContent = canonical;
    $('replacePreparedVerification').textContent = prepared;
    $('replaceR2Verification').textContent = r2;
    $('replaceVerifiedCurrentFile').textContent = currentFile;
    $('replaceVerifiedDisplayName').textContent = displayName;
    $('replacePublicationVerification').classList.remove('hidden');
  }
  function clearLoadedLesson() {
    loadedLesson = null;
    resources = [];
    clearVerification();
    $('replaceLessonSummary').classList.add('hidden');
    $('replaceResourceSelect').innerHTML = '<option value="">Load a lesson first</option>';
    $('replaceResourceSelect').disabled = true;
    $('replacementFile').value = '';
    $('replacementFile').disabled = true;
    $('replaceResourceBtn').disabled = true;
    $('replaceResourceDetail').classList.add('hidden');
  }

  function selectedResource() {
    const raw = $('replaceResourceSelect').value;
    if (raw === '') return null;
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? resources[index] || null : null;
  }

  function refreshReplaceButton() {
    const resource = selectedResource();
    const file = $('replacementFile').files?.[0] || null;
    $('replaceResourceBtn').disabled = replacing || !loadedLesson || !resource || !file;
  }

  function renderResourceDetail() {
    const resource = selectedResource();
    const box = $('replaceResourceDetail');
    if (!resource) {
      box.classList.add('hidden');
      $('replacementFile').disabled = true;
      $('replacementFile').value = '';
      refreshReplaceButton();
      return;
    }
    $('replaceCurrentResourceName').textContent = resource.displayName || resource.resourceId || 'Resource';
    $('replaceCurrentResourceKind').textContent = resource.kind || 'Resource';
    $('replaceCurrentResourceFile').textContent = basename(resource.r2Key);
    box.classList.remove('hidden');
    $('replacementFile').disabled = false;
    refreshReplaceButton();
  }

  async function loadLesson(preferredResourcePathToken='') {
    const input = $('replaceLessonId').value.trim();
    if (!input) { setStatus('Enter a lesson code first.', 'bad'); return { ok:false }; }
    clearVerification();
    $('loadReplaceLessonBtn').disabled = true;
    $('replaceResourceBtn').disabled = true;
    setStatus('Loading the current lesson resources…', 'warn');
    try {
      const data = await jsonApi('/api/v1/admin/resources/lesson', { lessonId:input });
      loadedLesson = data.lesson;
      resources = Array.isArray(data.resources) ? data.resources : [];
      $('replaceLessonCode').textContent = loadedLesson.lessonId || '';
      $('replaceLessonTitle').textContent = loadedLesson.title || '';
      $('replaceLessonSubject').textContent = loadedLesson.subject || '';
      $('replaceLessonSummary').classList.remove('hidden');

      const select = $('replaceResourceSelect');
      select.innerHTML = '';
      if (!resources.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No replaceable PDF resources found';
        select.appendChild(option);
        select.disabled = true;
        $('replacementFile').disabled = true;
        $('replaceResourceDetail').classList.add('hidden');
        setStatus('Lesson loaded, but it has no R2-backed resources that can be replaced.', 'warn');
        return { ok:true, resource:null };
      }

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose the existing resource…';
      select.appendChild(placeholder);
      resources.forEach((resource, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${resource.kind || 'Resource'} — ${resource.displayName || resource.resourceId || 'Resource'} | Current PDF: ${basename(resource.r2Key)}`;
        select.appendChild(option);
      });
      select.disabled = false;

      if (preferredResourcePathToken) {
        // A resourceId can be absent; the canonical object path remains stable.
        const matchIndex = resources.findIndex(resource => resource.pathToken === preferredResourcePathToken);
        if (matchIndex >= 0) select.value = String(matchIndex);
      }
      renderResourceDetail();
      setStatus(`Loaded ${resources.length} replaceable resource${resources.length === 1 ? '' : 's'} for ${loadedLesson.lessonId}.`, 'good');
      return { ok:true, resource:selectedResource() };
    } catch (error) {
      clearLoadedLesson();
      if (error.code === 'UNAUTHORISED') {
        localStorage.removeItem(TOKEN_KEY);
        setStatus('Your Admin session has expired. Reload this page and sign in again.', 'bad');
      } else if (error.code === 'LESSON_NOT_FOUND') {
        setStatus('That lesson code was not found. You can use the student-facing code or canonical lesson ID.', 'bad');
      } else if (error.code === 'AMBIGUOUS_LESSON_DISPLAY_ID') {
        setStatus('That lesson code matches more than one active lesson. Use the canonical lesson ID.', 'bad');
      } else {
        setStatus(`Could not load lesson resources: ${error.message}`, 'bad');
      }
      return { ok:false, error };
    } finally {
      $('loadReplaceLessonBtn').disabled = false;
      refreshReplaceButton();
    }
  }

  async function replaceResource() {
    if (replacing || !loadedLesson) return;
    const resource = selectedResource();
    const file = $('replacementFile').files?.[0] || null;
    if (!resource || !file) return;
    if (!/\.pdf$/i.test(file.name || '')) return setStatus('Choose a PDF replacement file.', 'bad');

    const confirmed = window.confirm(
      `Replace this Portal resource?\n\n` +
      `Lesson: ${loadedLesson.lessonId} — ${loadedLesson.title}\n` +
      `Resource: ${resource.displayName || resource.resourceId}\n` +
      `New file: ${file.name}\n\n` +
      `The existing Portal resource reference will be changed. The previous R2 object will be retained for rollback safety.`
    );
    if (!confirmed) return;

    replacing = true;
    refreshReplaceButton();
    setStatus('Uploading, verifying and publishing the replacement…', 'warn');
    try {
      const form = new FormData();
      form.append('lessonId', loadedLesson.lessonId);
      form.append('resourcePath', resource.pathToken);
      form.append('expectedR2Key', resource.r2Key);
      form.append('file', file, file.name);
      const data = await formApi('/api/v1/admin/resources/replace', form);
      $('replacementFile').value = '';
      // The consistency Worker verifies prepared publication before returning success.
      // Independently reload the canonical resource for a second readback.
      const refreshed = await loadLesson(resource.pathToken);
      const current = refreshed.resource;
      const canonicalVerified = Boolean(
        refreshed.ok && current && loadedLesson?.lessonId === data.lessonId &&
        current.pathToken === resource.pathToken && current.r2Key === data.newR2Key &&
        current.displayName === resource.displayName
      );
      const r2Verified = Boolean(data.newR2Key && /^[a-f0-9]{64}$/i.test(data.sha256 || ''));
      const preparedStatus = data.consistency === CONSISTENCY_MARKER ? data.preparedReadModel?.status : null;
      const preparedVerified = preparedStatus === 'published' &&
        Boolean(data.preparedReadModel?.version && /^[a-f0-9]{64}$/i.test(data.preparedReadModel?.sha256 || ''));
      const preparedLabel = preparedVerified
        ? 'Verified: current student lesson published and read back'
        : preparedStatus === 'not-published'
          ? 'Not published: no current prepared student lesson exists'
          : 'Not verified: no confirmed prepared-model readback';
      showVerification({
        canonical: canonicalVerified ? 'Verified: current canonical resource points to replacement' : 'Not verified: current canonical resource could not be confirmed',
        prepared: preparedLabel,
        r2: r2Verified ? `Verified by upload/readback SHA-256: ${data.sha256}` : 'Not verified from replacement response',
        currentFile: canonicalVerified ? basename(current.r2Key) : basename(data.newR2Key) || 'Unknown',
        displayName: canonicalVerified ? current.displayName : data.displayName || resource.displayName || 'Unknown'
      });
      if (canonicalVerified && r2Verified && preparedVerified) {
        setStatus(
          `Replacement verified for ${data.lessonId}. Canonical lesson, prepared student lesson and R2 PDF all passed readback. ` +
          'The student-facing name is unchanged; the previous R2 object is retained.',
          'good'
        );
      } else {
        setStatus(
          'The upload returned a response, but complete student-facing publication verification was not established. ' +
          'Check the details below before attempting another upload.',
          'warn'
        );
      }
    } catch (error) {
      if (error.code === 'RESOURCE_CHANGED') {
        setStatus('This resource changed after you loaded the lesson. Reload the lesson and check the current resource before trying again.', 'bad');
      } else if (error.code === 'INVALID_PDF') {
        setStatus('The selected file does not contain a valid PDF header.', 'bad');
      } else if (error.code === 'UNAUTHORISED') {
        localStorage.removeItem(TOKEN_KEY);
        setStatus('Your Admin session has expired. Reload this page and sign in again.', 'bad');
      } else {
        setStatus(`Replacement failed: ${error.message}`, 'bad');
      }
    } finally {
      replacing = false;
      refreshReplaceButton();
    }
  }

  $('loadReplaceLessonBtn')?.addEventListener('click', () => loadLesson());
  $('replaceLessonId')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); loadLesson(); }
  });
  $('replaceResourceSelect')?.addEventListener('change', () => { clearVerification(); renderResourceDetail(); });
  $('replacementFile')?.addEventListener('change', refreshReplaceButton);
  $('replaceResourceBtn')?.addEventListener('click', replaceResource);

  document.querySelectorAll('[data-admin-target]').forEach(button => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.adminTarget);
      target?.scrollIntoView({ behavior:'smooth', block:'start' });
      const focus = target?.querySelector('input:not([type=checkbox]),button');
      setTimeout(() => focus?.focus(), 250);
    });
  });
})();
