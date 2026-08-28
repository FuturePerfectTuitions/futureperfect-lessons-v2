import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPhase11Catalogue } from '../scripts/phase11-catalogue.mjs';
import { buildPhase11NavigationManifest } from '../scripts/phase11-navigation-manifest.mjs';
import {
  activeViewIdsBySubject,
  applyCanonicalHomeCounts,
  canonicalCatalogueRowsForView,
  fullLibraryOverlayUserForView,
  lockedPreviewUserForView,
  markCurrentViews,
  mergeCanonicalLockedRows
} from '../worker/src/index-phase12.js';
import {
  manualAccessCoversView,
  manualAccessOverlayUserForView,
  manualAccessViewIds
} from '../worker/src/phase15-manual-access.js';

const EXPECTED_CATALOGUE_SHA = '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663';

const catalogue = loadPhase11Catalogue();
const built = buildPhase11NavigationManifest(catalogue);
const manifest = built.manifest;
assert.equal(manifest.catalogueSha256, EXPECTED_CATALOGUE_SHA);
assert.equal(Object.keys(manifest.curricula).length, 11);
assert.equal(Object.keys(manifest.lessons).length, 369);

// Master v3.3: every visible Year/Level keeps its complete canonical catalogue.
// Existing entitlements remain open; missing canonical rows become locked only.
const m3 = canonicalCatalogueRowsForView('maths-year3', manifest);
assert.ok(m3.length > 1, 'Year 3 Maths canonical catalogue must contain multiple lessons');
const existingOpen = {
  lessonId: m3[0].lessonId,
  displayLessonId: m3[0].displayLessonId,
  title: m3[0].title,
  state: 'open',
  locked: false,
  blocked: false,
  preview: false,
  missedPreview: false
};
const listBody = { ok: true, lessons: [existingOpen] };
mergeCanonicalLockedRows(listBody, 'maths-year3', manifest);
assert.equal(listBody.lessons.length, m3.length);
assert.equal(listBody.lessons[0].lessonId, m3[0].lessonId);
assert.equal(listBody.lessons[0].locked, false);
assert.equal(listBody.lessons[1].lessonId, m3[1].lessonId);
assert.equal(listBody.lessons[1].state, 'locked');
assert.equal(listBody.lessons[1].locked, true);
assert.ok(!('resourceKey' in listBody.lessons[1]));

const homeBody = {
  ok: true,
  subjects: [
    {
      subject: 'maths',
      views: [{
        viewId: 'maths-year3',
        catalogueAvailable: true,
        visibleLessonCount: 1,
        openLessonCount: 1,
        lockedLessonCount: 0
      }]
    }
  ]
};
applyCanonicalHomeCounts(homeBody, manifest);
assert.equal(homeBody.subjects[0].views[0].visibleLessonCount, m3.length);
assert.equal(homeBody.subjects[0].views[0].openLessonCount, 1);
assert.equal(homeBody.subjects[0].views[0].lockedLessonCount, m3.length - 1);

// Master v3.3: multiple simultaneous active assignments in one subject are all Current.
const rows = [
  { batch_key: 'P15_M3A', subject: 'maths', school_year: 3, stream: 'normal', maths_level: null },
  { batch_key: 'P15_M4B', subject: 'maths', school_year: 4, stream: 'normal', maths_level: null },
  { batch_key: 'P15_E411', subject: 'english', school_year: 4, stream: '11plus', maths_level: null }
];
const active = activeViewIdsBySubject(rows);
assert.deepEqual([...active.get('maths')].sort(), ['maths-year3', 'maths-year4']);
assert.deepEqual([...active.get('english')], ['english-year4-11plus']);
const grouped = {
  subjects: [
    {
      subject: 'maths',
      views: [
        { viewId: 'maths-year2', current: true, group: 'current' },
        { viewId: 'maths-year3', current: false, group: 'previous' },
        { viewId: 'maths-year4', current: false, group: 'previous' }
      ]
    },
    {
      subject: 'english',
      views: [
        { viewId: 'english-year3', current: true, group: 'current' },
        { viewId: 'english-year4-11plus', current: false, group: 'previous' }
      ]
    }
  ]
};
markCurrentViews(grouped, rows);
const mathsById = new Map(grouped.subjects[0].views.map(view => [view.viewId, view]));
assert.equal(mathsById.get('maths-year2').current, false);
assert.equal(mathsById.get('maths-year2').group, 'previous');
assert.equal(mathsById.get('maths-year3').current, true);
assert.equal(mathsById.get('maths-year3').group, 'current');
assert.equal(mathsById.get('maths-year4').current, true);
assert.equal(mathsById.get('maths-year4').group, 'current');
const englishById = new Map(grouped.subjects[1].views.map(view => [view.viewId, view]));
assert.equal(englishById.get('english-year3').current, false);
assert.equal(englishById.get('english-year4-11plus').current, true);

// Full Library is an independent access source. A retained ordinary view for the
// same curriculum must not suppress an explicitly assigned 11+ Full Library.
// The compatibility overlay is request-local only and must not imply membership.
const fullLibraryUser = {
  firstName: 'Fixture',
  schoolYear: 5,
  batches: ['Y5E'],
  fullLibraries: ['ENGLISH_Y4_11PLUS_FULL'],
  blockedLessons: []
};
const y4ElevenLibrary = fullLibraryOverlayUserForView(fullLibraryUser, 'english-year4-11plus');
assert.equal(y4ElevenLibrary.schoolYear, 4);
assert.deepEqual(y4ElevenLibrary.batches, ['Y4E11']);
assert.deepEqual(y4ElevenLibrary.fullLibraries, ['ENGLISH_Y4_11PLUS_FULL']);
assert.deepEqual(fullLibraryUser.batches, ['Y5E'], 'source user must remain unchanged');
const noLibraryUser = { ...fullLibraryUser, fullLibraries: [] };
assert.equal(
  fullLibraryOverlayUserForView(noLibraryUser, 'english-year4-11plus'),
  noLibraryUser,
  'no explicit Full Library must not receive an overlay'
);

// Master v3.3 P24: a manual individual core lesson is an independent access
// source. It can surface that historical ordinary Year view, but the request-
// local presentation overlay must not mutate the source user or imply D1 batch
// membership. Only the explicitly manual lesson becomes open downstream.
const y4ManualLesson = manifest.curricula.ENGLISH_Y4.lessonIds.find(
  lessonId => manifest.lessons[lessonId]?.active !== false
);
assert.ok(y4ManualLesson, 'English Y4 requires an active canonical lesson for P24 regression');
const manualUser = {
  firstName: 'Fixture',
  schoolYear: 5,
  batches: ['Y5E'],
  manualAccess: { coreLessons: [y4ManualLesson], vrLessons: [] },
  fullLibraries: [],
  blockedLessons: []
};
assert.equal(manualAccessCoversView(manualUser, 'english-year4', manifest), true);
assert.ok(manualAccessViewIds(manualUser, manifest).includes('english-year4'));
assert.equal(manualAccessCoversView(manualUser, 'english-year3', manifest), false);
const y4ManualOverlay = manualAccessOverlayUserForView(manualUser, 'english-year4', manifest);
assert.equal(y4ManualOverlay.schoolYear, 4);
assert.deepEqual(y4ManualOverlay.batches, ['Y4E']);
assert.deepEqual(y4ManualOverlay.manualAccess.coreLessons, [y4ManualLesson]);
assert.deepEqual(manualUser.batches, ['Y5E'], 'manual source user must remain unchanged');
assert.equal(
  manualAccessOverlayUserForView({ ...manualUser, manualAccess: { coreLessons: [] } }, 'english-year4', manifest).schoolYear,
  5,
  'no manual lesson in the target curriculum must not receive an overlay'
);

// Locked-detail fallback must remain fail-closed and never create an entitlement.
const baseUser = {
  firstName: 'Fixture',
  schoolYear: 5,
  batches: ['Y5E'],
  fullLibraries: [],
  blockedLessons: []
};
const m3Preview = lockedPreviewUserForView(baseUser, 'maths-year3', m3[1].lessonId);
assert.deepEqual(m3Preview.batches, ['Y3E']);
assert.equal(m3Preview.schoolYear, 3);
assert.ok(m3Preview.blockedLessons.includes(m3[1].lessonId));
const level2Rows = canonicalCatalogueRowsForView('maths-level2', manifest);
assert.ok(level2Rows.length > 0);
const levelPreview = lockedPreviewUserForView(baseUser, 'maths-level2', level2Rows[0].lessonId);
assert.deepEqual(levelPreview.batches, []);
assert.ok(levelPreview.fullLibraries.includes('MATHS_L2_FULL'));
assert.ok(levelPreview.blockedLessons.includes(level2Rows[0].lessonId));

const source = fs.readFileSync(new URL('../worker/src/index-phase12.js', import.meta.url), 'utf8');
const manualSource = fs.readFileSync(new URL('../worker/src/phase15-manual-access.js', import.meta.url), 'utf8');
for (const text of [source, manualSource]) {
  assert.ok(!text.includes('INSERT INTO lesson_entitlements'));
  assert.ok(!text.includes('DELETE FROM lesson_entitlements'));
  assert.ok(!text.includes('UPDATE lesson_entitlements'));
  assert.ok(!text.includes('INSERT INTO student_batch_assignments'));
  assert.ok(!text.includes('DELETE FROM student_batch_assignments'));
  assert.ok(!text.includes('UPDATE student_batch_assignments'));
}

console.log('Phase 15 Master navigation regression: PASS');
