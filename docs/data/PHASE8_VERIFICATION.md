# FPT Portal V2 — Phase 8 Verification

Date: 22 August 2026  
Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`  
Scope: Phase 8 only — Answer Pack / Answer Key protection.  
Existing live portal: unchanged.

## 1. Phase 8 implementation verified

Phase 8 adds a separate per-open password gate for protected answer material without creating a session-wide unlock.

Implemented protection includes:

- current student Answer Pack password required for every protected open;
- 4-character password format validation;
- show/hide eye control on the Answer Pack password prompt;
- active student session validation before authorisation;
- lesson/view access validation before authorisation;
- protected resource ownership resolution server-side;
- private R2 existence check server-side;
- short-lived opaque answer-view token;
- token bound to the current student session and current Answer Pack password fingerprint;
- single-use protected PDF content open;
- controlled PDF.js canvas viewer rather than opening the browser PDF viewer;
- no normal download or print controls in the protected viewer UI;
- student watermark/header in the viewer;
- periodic lease revalidation while the viewer remains open;
- invalidation after logout/session revocation;
- invalidation when the student's current Answer Pack password changes;
- copied direct protected-view URL rejected when used outside the authorised portal origin/session context;
- D1-backed answer-view token and password-attempt rate-limit state.

## 2. Browser verification — Y5M1 Answer Pack

Test account: `test0101`  
Canonical lesson: `Y5M1`  
Student-facing Year 5 Maths display ID: `Y5T1M01`

Verified in Microsoft Edge against the isolated Phase 8 development page.

### Password prompt

PASS

- `Open Answer Pack` displays a dedicated protected-answer modal.
- Password field is masked by default.
- Eye control successfully shows/hides the password.
- Incorrect password is rejected.
- Correct current Answer Pack password opens the protected viewer.
- Closing the viewer and opening the Answer Pack again prompts for the password again; no session-wide unlock is retained.

### Controlled protected viewer

PASS

- Answer Pack renders inside the FPT controlled viewer using PDF.js/canvas rendering.
- Normal browser PDF download/print toolbar is not exposed.
- Viewer displays `test0101 — Future Perfect Tuitions` watermark/header.
- Raw R2 object path is not shown to the student.

### Password-change invalidation

PASS

- While the protected viewer was already open, the test student's Answer Pack password was temporarily changed in Students KV.
- On the next periodic lease validation, the open viewer removed the rendered answer pages and displayed `This protected view is no longer authorised`.
- The original test password was restored after the test.

### Session/logout invalidation

PASS

- Protected viewer was opened in one tab.
- The same student session was logged out from another tab.
- On the next lease validation, the already-open protected viewer invalidated itself and removed access to the answer pages.

### Copied/direct URL test

PASS

- A current `answer-view` URL was copied from Edge DevTools.
- The URL was opened in a separate Edge InPrivate window without an authenticated FPT portal session/origin context.
- Worker returned `{"error":"FORBIDDEN_ORIGIN"}`.
- The protected PDF did not open.

This demonstrates that possession of the temporary protected-view URL alone is insufficient to retrieve protected answer content.

## 3. D1 protection state

The following Phase 8 tables were created and verified as present:

- `answer_view_tokens`
- `answer_password_rate_limits`

These are additional security/ephemeral state only; ordinary permanent lesson entitlements remain separate.

## 4. Regression/debugging notes during Phase 8

A temporary navigation failure occurred during testing after the Y5M1 Lesson KV record was manually edited to add ScreenPal quiz metadata. The stored JSON was missing a comma between the `screenpal` and `quiz` properties, causing `/api/v1/student/home` to return `NAVIGATION_BUILD_FAILED`.

The Worker was temporarily given diagnostic exception logging to identify the JSON parser error. The malformed Y5M1 KV JSON was corrected and navigation immediately recovered. The diagnostic logging was then removed and the Worker returned to its normal catch behaviour.

The Y5M1 lesson video ScreenPal reference was also corrected during testing and video playback was reverified.

## 5. Phase 8 checkpoint

PASS

The Phase 8 checkpoint has been demonstrated with real browser behaviour:

- every protected Answer Pack open is re-authorised;
- the current personal Answer Pack password is required each time;
- protected material is served only through the controlled viewer;
- normal download/print controls are not provided;
- the viewer is watermarked;
- password changes invalidate an already-open view;
- logout/session invalidation invalidates an already-open view;
- copying the protected-view URL alone does not expose the PDF.

Phase 8 is therefore technically complete for ordinary lesson Answer Packs. VR Answer Keys/VR Answer Packs will reuse the same password/protected-view security model when the VR resource renderer is added in its later phase.

## 6. Carry-forward business rule

During Phase 8 testing, the workflow was clarified: **only 11+ students receive ScreenPal quizzes; normal-stream students do not receive quizzes.** This rule must remain enforced when quiz metadata/rendering is expanded and should be reflected in the next authoritative Master Specification revision before catalogue scaling.
