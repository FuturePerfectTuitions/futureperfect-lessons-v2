# Phase 7 — Complete Lesson Page Renderer Verification

**Status:** PASS  
**Verified:** 21 August 2026  
**Phase:** 7 — Build the Complete Lesson Page Renderer

## Scope

Phase 7 adds one reusable, data-driven lesson page for ordinary Maths and English lesson packages. The same renderer handles absent resources, single resources and repeated resource groups without lesson-specific HTML or JavaScript.

The existing live portal was not changed.

## Governing checkpoint

Steps to Progression requires Phase 7 to prove that differently structured lessons render correctly without page-specific code, including:

- student-facing Lesson ID, title and full description/topics;
- zero/one/many PreLesson Sheets;
- zero/one main ScreenPal video;
- zero/one/many Homework items;
- one-to-one Homework → Answer Pack pairing;
- optional Other Resources;
- empty sections hidden entirely;
- downloadable resources available only after Worker access validation.

The Phase 7 browser tests satisfy this checkpoint.

## Implemented frontend

Phase 7 proof page:

- `phase7.html`
- `assets/phase7.css`
- `assets/phase7.js`
- `assets/phase7-upsell.js`

`phase7.js` reuses the authenticated Phase 4/6 session and navigation flow, then renders lesson packages from Worker-provided data.

`phase7-upsell.js` applies the agreed cross-subject upsell presentation rule: Year/Level cards and lesson-list rows remain inviting; the first explicit Locked/Preview state appears on the individual lesson page.

## Implemented Worker adapter

Phase 7 Worker adapter:

- `worker/src/index-phase7.js`

It composes the completed Phase 6 Worker in `worker/src/index.js` rather than replacing the established authentication/navigation implementation.

Phase 7 routes include:

- augmented `GET /api/v1/student/views/{viewId}/lessons` with student-facing display IDs;
- `GET /api/v1/student/lessons/{lessonId}?viewId={viewId}`;
- `GET /api/v1/student/resources/{resourceKey}/download?viewId={viewId}`;
- `GET /api/v1/student/resources/{resourceKey}/video?viewId={viewId}`.

## Resource-security behaviour

The browser never receives raw R2 paths or raw ScreenPal IDs as ordinary lesson-page data.

For a locked lesson, the Worker safe lesson model returns resource display names/structure but omits usable resource keys. Direct download/video handlers independently re-check the visible lesson context and return `LESSON_LOCKED` when the lesson is locked.

For an open lesson, downloadable resources are streamed through the Worker after visibility/access validation. The ScreenPal embed reference is returned only through the authorised video endpoint.

Phase 8 remains responsible for the stronger per-open Answer Pack/Answer Key password gate and controlled protected-answer viewer.

## Browser verification matrix

### 1. Real-shaped open lesson — canonical `Y5M1`

Using `test0101` in normal Year 5 Maths:

- student-facing ID shows `Y5T1M01`;
- full title and description render;
- one PreLesson Sheet renders and downloads;
- one ScreenPal lesson video embeds inside the portal;
- Homework renders and downloads;
- Answer Pack is visibly protected;
- Back navigation and Logout remain available.

### 2. Minimal lesson — `DEV-P7-MIN`

Development-only fixture with no PreLesson Sheets, no video, no Homework and no Other Resources.

Verified:

- lesson ID/title/description render;
- PreLesson section absent;
- Lesson Video section absent;
- Homework section absent;
- Other Resources section absent.

This proves empty sections are hidden rather than rendered as empty placeholders.

### 3. Multiple-resource lesson — `DEV-P7-MANY`

Development-only fixture containing:

- two PreLesson Sheets;
- one ScreenPal video;
- two Homework/Answer Pack pairs;
- two Other Resources.

Verified that all repeated items render independently and each Homework remains visibly paired with its own Answer Pack.

### 4. Ordinary English renderer proof — `DEV-P7-ENGLISH`

Development-only English fixture verified through the same Phase 7 lesson-page component. It intentionally contains no VR extension; VR remains a Phase 9 concern.

### 5. Cross-subject upsell preview

Business-rule refinement verified during Phase 7:

- cross-subject Year/Level card does **not** show a lock/Preview badge;
- cross-subject lesson-list row does **not** reveal a Locked state and instead remains navigable;
- first explicit Locked/Preview indication appears on the individual lesson page;
- locked page exposes title, description, section structure and resource display names only;
- PreLesson, video, Homework and Answer Pack remain inaccessible.

This behaviour was browser-verified with `test0202` viewing the real-shaped Maths `Y5M1` lesson as a cross-subject preview.

## Student-facing display-ID regression

During Phase 7 browser testing the canonical `lesson:Y5M1` KV record was found to lack its `displayIds` metadata. The data was corrected to preserve the Master Specification rule:

```json
"displayIds": {
  "maths-year5": "Y5T1M01",
  "maths-level2": "L2T1M01"
}
```

Browser regression verified:

- normal Year 5 presentation → `Y5T1M01 Number and Place Value I`;
- Level 2 presentation → `L2T1M01 Number and Place Value I`;
- canonical/internal entitlement key remains `Y5M1`.

The canonical ID therefore remains stable while the view-specific alias changes correctly.

## Development fixture state

Detailed Phase 7 KV/D1 fixture definitions are recorded in:

- `docs/data/PHASE7_FIXTURES.md`

These are development-only fixtures and must not be mistaken for production curriculum data.

## Regression / safety result

Verified during Phase 7 work:

- Phase 4 secure login/session model remains in use;
- single-active-session behaviour remains intact;
- Phase 5 visual shell remains intact;
- Phase 6 Worker-authoritative Year/Level navigation remains intact;
- student-facing display IDs work in both Year and Level presentations;
- cross-subject resource access remains locked server-side;
- normal real-student login remains disabled;
- no production CNAME was added;
- no existing live portal repository, live Worker or live KV namespace was changed.

## Phase 7 checkpoint

**PASS.**

A range of materially different lesson packages now render correctly through one reusable lesson-page implementation without page-specific code. Empty sections disappear, repeated resources render correctly, student-facing IDs remain view-specific, and locked cross-subject previews expose safe metadata/structure without granting resources.

## Next phase

Phase 8 — Build Answer Pack and Answer Key Protection.

Per the phase-boundary workflow, stop after the Phase 7 cumulative handover is updated. Phase 8 must begin in a new chat after reading the latest Master, Steps and Handover and re-inspecting GitHub/Cloudflare state.