from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    p.write_text(text.replace(old, new, 1))


importer = 'worker/src/admin-lesson-release-import.js'
replace_once(
    importer,
    "import { viewDefinition, viewIdForBatch } from '../../rebuild/shared/read-models/view-registry.mjs';\n",
    "import { viewDefinition, viewIdForBatch } from '../../rebuild/shared/read-models/view-registry.mjs';\nimport { publishStudentPreparedAccess } from './admin-prepared-access-publisher.js';\n"
)

replace_once(
    importer,
    """function configured(env) {
  return Boolean(
    env?.STUDENTS_KV &&
    env?.LESSONS_KV &&
    env?.DB &&
    env?.ADMIN_IMPORT_PASSWORD &&
    env?.ADMIN_IMPORT_SESSION_SECRET
  );
}
""",
    """function configured(env) {
  return Boolean(
    env?.STUDENTS_KV &&
    env?.LESSONS_KV &&
    env?.REBUILD_SHADOW_KV &&
    env?.DB &&
    env?.ADMIN_IMPORT_PASSWORD &&
    env?.ADMIN_IMPORT_SESSION_SECRET
  );
}
"""
)

replace_once(
    importer,
    """  const candidates = applyCandidates(preview);
  const results = [];
  for (const item of candidates) {
    results.push(await applyItem(env, item));
  }

  return json({
    ok:true,
    results,
    summary:{
      total:results.length,
      succeeded:results.filter(r => r.ok).length,
      failed:results.filter(r => !r.ok).length
    }
  }, 200, request, env);
""",
    """  const candidates = applyCandidates(preview);
  const entitlementResults = [];
  for (const item of candidates) {
    entitlementResults.push(await applyItem(env, item));
  }

  // The rebuilt Student Worker reads prepared access snapshots, not raw D1
  // entitlements. A Portal action is therefore not complete until every
  // affected student's snapshot has been compiled from the authoritative
  // post-write state and atomically published. Multiple lesson rows for the
  // same student are collapsed to one publication AFTER all D1 writes, while
  // individual lesson rows remain separate for parent-email handling.
  const affectedUsers = [...new Set(
    entitlementResults
      .filter(row => row.ok && row.portalUserIdNorm)
      .map(row => row.portalUserIdNorm)
  )];
  const publicationByUser = new Map();
  for (const portalUserIdNorm of affectedUsers) {
    try {
      publicationByUser.set(
        portalUserIdNorm,
        await publishStudentPreparedAccess(env, portalUserIdNorm)
      );
    } catch (error) {
      publicationByUser.set(portalUserIdNorm, {
        ok:false,
        error:clean(error?.message) || 'PREPARED_ACCESS_PUBLISH_FAILED'
      });
    }
  }

  const results = entitlementResults.map(row => {
    if (!row.ok) return row;
    const publication = publicationByUser.get(row.portalUserIdNorm);
    if (!publication?.ok) {
      return {
        ...row,
        ok:false,
        status:'PREPARED_ACCESS_PUBLISH_FAILED',
        entitlementApplied:true,
        preparedAccessReady:false,
        message:`The entitlement was written, but the live prepared access model could not be published: ${clean(publication?.error) || 'unknown error'}`
      };
    }
    return {
      ...row,
      preparedAccessReady:true,
      preparedAccessChanged:publication.published === true,
      preparedAccessVersion:clean(publication.version)
    };
  });

  return json({
    ok:true,
    results,
    summary:{
      total:results.length,
      succeeded:results.filter(r => r.ok).length,
      failed:results.filter(r => !r.ok).length
    }
  }, 200, request, env);
"""
)

parent = 'worker/src/parent-email.js'
replace_once(
    parent,
    """function emailTypeForItem(item) {
  const status = clean(item?.lessonStatus);
  if (/\\bslide\\b/i.test(status)) return 'ONGOING';
  if (completedStatus(status)) {
    if (partialProgressFromRemarks(item?.remarks)) return 'ONGOING';
    return 'COMPLETED';
  }
""",
    """function emailTypeForItem(item) {
  const status = clean(item?.lessonStatus);
  // Final lesson status is authoritative. A Completed macro can leave a
  // historical progress remark such as \"Start from Slide 20\" on the row;
  // that remark must never turn the completed lesson back into Ongoing.
  if (completedStatus(status)) return 'COMPLETED';
  if (/\\bslide\\b/i.test(status)) return 'ONGOING';
"""
)

test = 'tests/admin-lesson-release-import-verification.mjs'
replace_once(
    test,
    """const db = new MemoryDB();
const env = {
  DB:db,
  STUDENTS_KV:{ async get(key) { return students.get(key) || null; } },
  LESSONS_KV:{ async get(key) { return lessons.get(key) || null; } },
""",
    """const db = new MemoryDB();
const preparedPublishCalls = [];
const env = {
  DB:db,
  STUDENTS_KV:{ async get(key) { return students.get(key) || null; } },
  LESSONS_KV:{ async get(key) { return lessons.get(key) || null; } },
  REBUILD_SHADOW_KV:{},
  __TEST_PREPARED_ACCESS_PUBLISHER:async portalUserIdNorm => {
    preparedPublishCalls.push(portalUserIdNorm);
    return { ok:true, published:true, version:`test-${portalUserIdNorm}-${preparedPublishCalls.length}` };
  },
"""
)

replace_once(
    test,
    """assert.equal(confirm.body.summary.failed, 0);
assert.equal(db.prelessons.size, 1);
""",
    """assert.equal(confirm.body.summary.failed, 0);
assert.equal(confirm.body.results.every(row => row.preparedAccessReady === true), true);
assert.deepEqual(preparedPublishCalls, ['pre0101','full0202'], 'Prepared access must publish once per affected student, not once per lesson row.');
assert.equal(db.prelessons.size, 1);
"""
)

p = Path(test)
text = p.read_text()
marker = "console.log('Lesson release importer validates ambiguous batch views and preserves safe single-view fallback + FULL/PRELESSON_ONLY + continuing FULL release: PASS');"
if marker not in text:
    raise SystemExit('admin importer final PASS marker not found')
injection = """
// A D1 entitlement write without a successful prepared-model publication
// must be reported as a failed Portal action so the email layer cannot
// claim success or send a parent email against stale live access.
const goodPublisher = env.__TEST_PREPARED_ACCESS_PUBLISHER;
env.__TEST_PREPARED_ACCESS_PUBLISHER = async () => { throw new Error('synthetic publish failure'); };
const publishFailure = await call(
  '/api/v1/admin/lesson-releases/confirm',
  { rows:[upgradeRow] },
  token
);
assert.equal(publishFailure.response.status, 200);
assert.equal(publishFailure.body.summary.succeeded, 0);
assert.equal(publishFailure.body.summary.failed, 1);
assert.equal(publishFailure.body.results[0].status, 'PREPARED_ACCESS_PUBLISH_FAILED');
assert.equal(publishFailure.body.results[0].entitlementApplied, true);
assert.equal(publishFailure.body.results[0].preparedAccessReady, false);
env.__TEST_PREPARED_ACCESS_PUBLISHER = goodPublisher;

"""
p.write_text(text.replace(marker, injection + marker, 1))

email_test = 'tests/parent-email-completed-status-verification.mjs'
replace_once(
    email_test,
    """const workbookOngoing = { ...row, LessonStatus:'Completed', Remarks:'Completed till slide 10' };
assert.equal(normaliseCsvInputRow(workbookOngoing).LessonStatus, 'Completed');
assert.equal(emailItemFromRow(workbookOngoing).emailType, 'ONGOING');
""",
    """const workbookCompletedWithProgressHistory = { ...row, LessonStatus:'Completed', Remarks:'Completed till slide 10' };
assert.equal(normaliseCsvInputRow(workbookCompletedWithProgressHistory).LessonStatus, 'Completed');
assert.equal(emailItemFromRow(workbookCompletedWithProgressHistory).emailType, 'COMPLETED');

// One session may finish multiple lessons and then stop part-way through
// the next one. Email classification is per lesson row, never per session.
const sameSession = [
  { ...row, Lesson:'L2T1M01 Number and Place Value I', LessonStatus:'Completed', Remarks:'Start from Slide 20' },
  { ...row, Lesson:'L2T1M02 Number and Place Value II', LessonStatus:'Completed', Remarks:'Completed till Slide 38' },
  { ...row, Lesson:'L2T1M03 Number and Place Value III', LessonStatus:'Slide 5', Remarks:'Start from Slide 5' }
];
assert.deepEqual(
  sameSession.map(item => emailItemFromRow(item).emailType),
  ['COMPLETED','COMPLETED','ONGOING']
);
"""
)

print('Exact importer/email source patches applied.')
