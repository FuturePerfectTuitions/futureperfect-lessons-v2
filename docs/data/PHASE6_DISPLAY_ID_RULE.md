# Phase 6 — Student-facing Maths Lesson ID Rule

Status: authoritative Phase 6 presentation rule, agreed 21 August 2026.

## Canonical ID versus student-facing ID

V2 must keep one canonical/internal Lesson ID for entitlement, blocking, catalogue/resource ownership and duplicate prevention. The same canonical Maths lesson may have a different student-facing Lesson ID depending on whether it is being presented as a normal school Year or an 11+ Level.

This is presentation aliasing only. It must never create a second lesson record or a second entitlement for shared canonical content.

## Required examples

For the first shared `MATHS_L2` lesson, currently represented internally by canonical `Y5M1` and titled `Number and Place Value I`:

- Normal Year 5 presentation: `Y5T1M01 Number and Place Value I`
- Level 2 / 11+ presentation: `L2T1M01 Number and Place Value I`

The stored title should not cause the old canonical prefix (`Y5M1`) to be repeated in the student UI.

The same principle applies across shared Maths curricula:

- normal Year views use Year-form student IDs such as `Y5T1M01`;
- 11+ Level views use Level-form student IDs such as `L2T1M01`;
- exact term and lesson sequence should ultimately come from catalogue presentation metadata when the full catalogue is loaded.

## Phase 6 implementation

`assets/phase6.js` now supports a `displayLessonId` supplied by the API and has development fallbacks for the currently loaded proof data:

- `maths-year5` + canonical `Y5M1` → `Y5T1M01`
- `maths-level2` + canonical `Y5M1` → `L2T1M01`
- Level 3 Phase 6 fixtures display `L3T1M01`, `L3T1M02`, `L3T1M03`.

Search matches the student-facing ID as well as the underlying canonical ID during development. The canonical ID remains hidden from the normal lesson-list presentation.

## Production catalogue requirement

When the real catalogue is loaded, exact student-facing aliases should be carried as catalogue/API presentation metadata rather than inferred from batch IDs. Entitlements and access checks continue to use the canonical/internal Lesson ID.
