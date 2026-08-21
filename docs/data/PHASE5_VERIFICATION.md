# Phase 5 Verification — V2 Visual Shell

**Date:** 21 August 2026  
**Status:** PASS

## Scope

Phase 5 carried the established Future Perfect Tuitions visual identity into the isolated V2 student-facing shell while preserving the Phase 4 secure session model and keeping the existing live portal untouched.

## Implemented frontend

- `phase5.html` — student-facing Phase 5 shell.
- `assets/phase5.css` — FPT visual shell styling and responsive rules.
- `assets/phase5.js` — secure Phase 4 session-aware login/logout and subject-shell behaviour.
- `assets/fpt-logo.png` — copied visual asset from the existing portal for V2 use.

## Visual checkpoint

Manually verified in browser:

- real Future Perfect Tuitions logo renders correctly;
- FPT navy `#012169` and red `#D71920` are retained;
- pale-grey application background and rounded white cards are retained;
- red/white/blue airmail border surrounds the viewport;
- login screen visually matches the established FPT language while referring to complete lesson resources rather than only videos;
- authenticated shell shows a first-name-only greeting;
- Logout is easy to reach;
- exactly two top-level subject choices are shown: Maths and English;
- no VR third top-level subject is shown;
- no batch IDs or internal implementation identifiers are shown to the student;
- desktop layout renders cleanly.

## Authentication/session regression

Phase 5 uses the Phase 4 endpoints and does not restore legacy Basic Auth or browser-stored credentials.

Manually verified:

- existing authenticated session is recognised;
- logout returns to the V2 login screen;
- password field is cleared after logout;
- show/hide password control works;
- wrong password is rejected with generic invalid-login messaging;
- correct development credentials return the user to the Maths/English shell;
- first name is returned from the authenticated session and displayed as `Welcome, Test` / `Hi, Test` for the development account.

## Edge browser note

Microsoft Edge displayed its own native password-reveal control in addition to the portal's explicit eye button. Phase 5 CSS now suppresses the Edge/legacy-MS native reveal/clear controls so the portal's own consistent eye control is the only one intended to display.

## Development safety

- Work is confined to `FuturePerfectTuitions/futureperfect-lessons-v2`.
- No production CNAME was added.
- No existing live portal files, Worker, or live KV namespaces were changed.
- Normal real-student login remains disabled server-side; only the development allowlist is permitted.

## Phase 5 checkpoint

**PASS.** V2 now visibly feels like the next version of the current Future Perfect Tuitions portal rather than a separate unrelated product, while retaining the secure Phase 4 session model.

## Next phase

Phase 6 — Build Curriculum Navigation.

The next implementation work is to turn the Master Specification's Year/Level visibility, entitlement, historical-access and cross-subject locked-preview rules into authenticated student navigation. This will require the currently unimplemented student home/view/lesson API surface and frontend navigation beyond the two subject choices.
