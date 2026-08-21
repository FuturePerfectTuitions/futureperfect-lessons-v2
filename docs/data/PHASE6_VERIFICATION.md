# Phase 6 — Curriculum Navigation Verification

**Status:** PASS  
**Verified:** 21 August 2026  
**Phase:** 6 — Build Curriculum Navigation

## Scope

Phase 6 turns the Master Specification's entitlement/configuration rules into the student's Year/Level navigation while retaining the Phase 4 secure-session model and Phase 5 FPT visual shell.

The existing live portal was not changed.

## Implemented frontend

Phase 6 proof page:

- `phase6.html`
- `assets/phase6.css`
- `assets/phase6.js`

Verified browser flow:

`Login → Maths / English → Year or Level → continuous lesson list`

The Phase 6 list does not use Current/Previous grouping and does not use Autumn/Spring/Summer sections.

## Implemented Worker navigation API

Canonical Worker source: `worker/src/index.js`

Authenticated routes added and deployed:

- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`

The frontend no longer invents Year/Level access. The Worker computes current views, historical views, Full Library views, cross-subject previews, direct/manual entitlement and 11+ start-point visibility.

## D1 start-point migration

Migration:

- `worker/migrations/0004_curriculum_start_points.sql`

Installed and verified in `fpt_portal_v2_db`.

Table:

- `curriculum_start_points`

Purpose: preserve the first ordinary Excel start point for actively taught 11+ Maths Level 2 / Level 3 so earlier missed lessons may be shown locked without granting entitlement and future unreleased lessons remain hidden.

## Development personas verified

### Test0101 — current normal Year 5 Maths

Configured externally as `user:test0101`.

Verified:

- login succeeds in development;
- Maths → Year 5;
- Y5M1 canonical lesson is available;
- English → Year 5 locked cross-subject preview;
- no internal Batch ID is shown;
- search works by lesson code/title;
- logout returns to login.

After the Phase 6 student-facing-ID correction, the same canonical lesson is displayed to a normal Year 5 student as:

- `Y5T1M01 Number and Place Value I`

The canonical/internal entitlement key remains `Y5M1`.

### Test0202 — current Year 5 English only

Development KV key:

- `user:test0202`

Verified:

- English → Year 5 current view;
- real English catalogue is not yet loaded, so the UI reports that the Year/Level catalogue is not available rather than inventing lesson metadata;
- Maths → Year 5 locked cross-subject preview;
- Y5M1 catalogue row appears locked in the Maths preview;
- Back navigation works;
- no internal Batch ID is shown.

### Test0303 — current Year 5 11+ Maths

Development KV key:

- `user:test0303`

Current presentation test data:

- current batch `Y5M11DEV1`;
- continuing Full Library `MATHS_L2_FULL`;
- Level 3 current lesson entitlement `DEV-L3-02`;
- Level 3 start point at lesson order 2.

Verified Year/Level navigation:

- Maths → Level 2;
- Maths → Level 3;
- no duplicate Year 5 Maths view for canonical Level 2 content;
- English → Year 5 11+ locked cross-subject preview.

Verified Level 3 start-point list:

- `DEV-L3-01` appears locked as the earlier missed-lesson preview;
- `DEV-L3-02` appears available;
- `DEV-L3-03` is hidden as future/unreleased content.

This proves that the start point affects presentation only and does not itself create entitlement.

## Student-facing lesson ID rule added during Phase 6

A business-rule correction was identified during browser testing: shared canonical Maths content must use a presentation-specific student-facing Lesson ID.

Examples:

- normal Year 5 view: `Y5T1M01 Number and Place Value I`;
- Level 2 / 11+ view: `L2T1M01 Number and Place Value I`.

The entitlement/content key remains the single canonical/internal lesson record. The display alias changes with the Year/Level presentation and must not duplicate entitlement.

The Phase 6 frontend was updated so search and list display use the student-facing alias while preserving the canonical ID internally.

The corresponding business rule was versioned into the Master Authoritative Specification v2.3 and Steps to Progression v1.3.

## Development-only fixtures

Reproducible fixture definitions are recorded in:

- `docs/data/PHASE6_PERSONA_FIXTURES.md`

Development allowlist during Phase 6 testing:

- `test0101,test0202,test0303`

These are development-only personas. Normal production student login remains disabled.

## Manual Cloudflare testing rule

Sej is a beginner with Cloudflare/D1/KV operations. Future handovers must preserve the following interaction rule:

- Give Cloudflare/KV/D1/manual deployment instructions in small, explicit steps.
- Prefer one risky/manual configuration step at a time and wait for confirmation or screenshot before proceeding.
- Simple browser checks may be grouped into two or three actions when safe.
- Never assume familiarity with where Worker variables, KV entries, D1 Studio or deployment controls are located.

## Regression / safety result

Verified during Phase 6 work:

- Phase 4 secure login/session model remains in use;
- single-device/session rules were not replaced;
- Phase 5 visual shell remains intact;
- no production CNAME was added;
- normal real-student login remains disabled;
- no existing live portal repository, live Worker or live KV namespace was changed.

## Phase 6 checkpoint

**PASS.**

Several dummy student personas now see the correct Year/Level labels and lesson lists, including normal Year presentation, Level presentation, Full Library continuity, cross-subject locked previews, canonical de-duplication, 11+ missed-lesson start-point behaviour and future-lesson hiding.

## Next phase

Phase 7 — Build the Complete Lesson Page Renderer.

Per the agreed project workflow, Phase 7 must begin in a new chat after the completed Phase 6 handover has been produced and reviewed.
