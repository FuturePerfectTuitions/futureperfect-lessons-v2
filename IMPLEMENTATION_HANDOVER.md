# FPT Portal V2 — Implementation Handover

**Cumulative version:** 3.9  
**Updated:** 22 August 2026  
**Completed through:** Phase 10 — Existing Special Content Areas + final navigation/count corrections

**STATUS: PHASES 1–10 COMPLETE · PHASE 11 MUST START IN A NEW CHAT**

## 1. Governing authority

Use this file together with:

1. **Master Authoritative Specification v2.7 (22 August 2026)** — business/workflow authority;
2. **Steps to Progression v1.7 (22 August 2026)** — build-sequence/checkpoint authority;
3. **this cumulative handover v3.9** — actual implementation state completed through Phase 10;
4. the actual current GitHub and deployed Cloudflare V2 state whenever exact code/deployment state matters.

The existing live portal remains separate and must not be changed to solve V2 problems.

## 2. Permanent working rules

- Finish and verify the current phase completely before starting the next.
- Update the cumulative handover after verified implementation changes.
- Every new phase starts in a new chat.
- At the start of a new phase: read Master + Steps + Handover, reconnect to GitHub, inspect the current implementation and deployed V2 development state, then begin work.
- Prefer the established guarded GitHub Actions → Cloudflare path where practical.
- Never expose Cloudflare credential values, Worker secrets or operational mock passwords in chat/source control.
- Normal production student login remains disabled during development.
- Never target the existing live portal from a V2 workflow.

## 3. Cumulative build status

| Phase | Status | Implementation state |
|---|---|---|
| 1 | COMPLETE | Isolated GitHub Pages + V2 Worker + Students KV + Lessons KV + D1 + R2. |
| 2 | COMPLETE | V2 data foundations and idempotent Student + Lesson entitlement model. |
| 3 | COMPLETE | One complete real-shaped Maths lesson through protected Answer Pack proof. |
| 4 | COMPLETE | Secure opaque sessions, 2-hour inactivity, logout and single-device login. |
| 5 | COMPLETE | FPT visual shell and Maths/English student entry. |
| 6 | COMPLETE | Worker-authoritative Year/Level navigation, Current/Previous grouping per subject, independent Maths/English history, locked previews and 11+ start-point behaviour. |
| 7 | COMPLETE | Reusable complete ordinary lesson-page renderer and Worker-gated resources. |
| 8 | COMPLETE | Per-open Answer Pack/Answer Key protection and controlled PDF.js viewer. |
| 9 | COMPLETE | Shared English core + English 11+ VR + 11+-only ScreenPal quiz gate. |
| 10 | COMPLETE | 11+ Maths Assessments + Y5 11+ MOCKS/daily-password protection + VR How-To through manual special access, corrected special-area counts and verified multi-year Current/Previous navigation. |
| 11 | NEXT | Load the real lesson catalogue. Do not begin inside the Phase 10 chat. |

## 4. Core architecture carried forward

### Authentication / navigation

- Username comparison is case-insensitive.
- Browser receives an opaque secure session; raw student password is not replayed on every request.
- Two-hour inactivity timeout remains enforced.
- Exactly one active session per Portal User ID remains enforced; latest successful login wins.
- Top-level student subjects remain exactly **Maths** and **English**.
- Maths uses Year terminology for normal streams and Level terminology for 11+ views.
- English normal and English 11+ share canonical core content by school year.
- Within each subject, Year/Level views are grouped into **Current** and **Previous**.
- Current derives from active subject configuration; Previous derives from retained historical Year/Level/Full-Library access.
- Maths and English histories are independent; a past year in one subject must not create a mirrored year in the other subject.
- Current/Previous grouping is presentation only and creates no entitlement.

### Ordinary lesson renderer

Phase 7 remains the reusable ordinary lesson renderer:

- `phase7.html`
- `assets/phase7.js`
- `assets/phase7.css`
- `assets/phase7-upsell.js`
- Worker adapter `worker/src/index-phase7.js`

It supports student-facing Lesson IDs, descriptions, zero/one/many PreLesson Sheets, optional main ScreenPal video, zero/one/many Homework items, explicit Homework→Answer Pack pairing, optional Other Resources, hidden empty sections and safe locked cross-subject previews.

### Protected answers

Phase 8 remains composed underneath later phases:

- `worker/src/index-phase8.js`
- `phase8.html`
- `assets/phase8.js`
- `assets/phase8.css`

Protected Answer Packs/Keys prompt for the current personal Answer Pack password on every open, use short-lived single-use capabilities, render through the controlled PDF.js/canvas viewer, do not expose raw R2 answer URLs, and are invalidated by session revocation/password change.

D1 security tables include:

- `answer_view_tokens`
- `answer_password_rate_limits`

### Phase 9 English / VR / quiz model

- `worker/src/index-phase9.js`
- `phase9.html`
- `assets/phase9.js`
- `assets/phase9.css`

Normal English and English 11+ share one canonical core lesson. English 11+ may add nested VR resources. ScreenPal quiz metadata/routes are exposed only in authorised 11+ presentation context; normal Maths/English presentations receive no quiz. A bare ScreenPal quiz ID is never guessed into a URL; an openable quiz requires an approved explicit HTTPS ScreenPal share/embed URL.

## 5. Phase 10 special-content implementation

### Manual special-access model

Control point:

- `manualAccess.specialBuckets`

Recognised codes:

- `Y4MAssT1`, `Y4MAssT2`
- `Y5MAssT1`, `Y5MAssT2`
- `VR_HOWTO`
- `MOCKS`

Ordinary Excel/D1 `lesson_entitlements` do **not** grant these areas.

Student placement:

| Special code | V2 location |
|---|---|
| `Y4MAssT1`, `Y4MAssT2` | Maths → Level 2 |
| `Y5MAssT1`, `Y5MAssT2` | Maths → Level 3 |
| `VR_HOWTO` | English → Year 4 11+ / Year 5 11+ |
| `MOCKS` | Maths → Level 3 and English → Year 5 11+ |

Special catalogue key family remains `special:<SPECIAL_BUCKET_CODE>`.

Student routes include:

- `GET /api/v1/student/special-areas?viewId={viewId}`
- `GET /api/v1/student/special-areas/{bucketId}?viewId={viewId}`
- `GET /api/v1/student/special-resources/{resourceKey}/video?viewId={viewId}`
- `POST /api/v1/student/special-areas/MOCKS/mock-days/{day}/unlock?viewId={viewId}`

### MOCKS daily-password protection

- MOCKS is a manually assigned Year 5 11+ special area.
- One mock-day password unlocks both that day’s Maths and VR answer videos.
- Daily mock password is separate from the student’s personal Answer Pack password.
- Locked payloads expose safe display metadata only; no usable ScreenPal ID/URL/embed/resource key is returned before successful verification.
- Daily passwords are read from Worker secret/config `MOCK_DAILY_PASSWORDS`; value is deliberately not recorded.
- D1 `mock_password_rate_limits` provides short-lived guessing protection; migration `worker/migrations/0006_mock_password_rate_limits.sql`.

### Student-facing available-lesson total

Final Phase 10 rule:

`available lessons = open ordinary lessons + visible manually assigned special-area cards in that view`.

This is a **presentation-count rule only**. Special areas continue to derive from `manualAccess.specialBuckets` and are not converted into ordinary Excel/D1 lesson entitlements.

Frontend helper:

- `assets/phase10-counts.js`

### Current / Previous multi-year correction

Final Phase 10 deployed Worker entrypoint:

- `worker/src/index-phase10-history.js`

It composes:

`Phase 10 history/navigation layer → Phase 10 special-content layer → Phase 9 → Phase 8 → Phase 7 → base Worker`.

Frontend grouping helper:

- `assets/phase10-history.js`

Development regression persona `test0707` proves independent subject history:

- Maths Current: Year 5;
- Maths Previous: Year 3, Year 4;
- English Current: Year 5;
- English Previous: Year 4 only;
- deliberately no Year 3 English history.

Sej manually logged into the V2 development portal and accepted this presentation before Phase 10 closure.

## 6. Phase 10 final verification / GitHub history

Original Phase 10 implementation and guarded deployment were completed before manual review. Final corrections were then merged:

- PR #11 — special-area available-lesson count correction;
- PR #12 — multi-year Current/Previous regression persona/navigation;
- PR #14 — verification workflow plumbing fix;
- PR #15 — successful guarded final rerun.

Latest Phase 10 code/operations merge recorded before closure:

- `a72453f93f6ae6d5a586d8354fefe536a05bfa5d`

Final guarded run:

- GitHub Actions run `32569205163` — **PASS**.

Final verification proved:

- exact isolated V2 Worker/environment/origin/bindings before writes;
- Phase 8/9/10 security baseline retained;
- Worker dry run + development-only deployment passed;
- test0707 Students KV and five D1 history entitlements were re-read/verified;
- Phase 10 multi-year history API acceptance: **PASS**;
- real Google Chrome 151 browser acceptance: **PASS**;
- browser proof matched the independent Maths/English Current/Previous groups above;
- three screenshots retained in artifact `phase10-history-browser-screenshots`.

Final closure record:

- `docs/data/PHASE10_FINAL_CLOSURE.md`

Detailed original Phase 10 verification remains:

- `docs/data/PHASE10_VERIFICATION.md`

## 7. Current development state

Repository:

- `FuturePerfectTuitions/futureperfect-lessons-v2`
- branch: `main`

Development portal:

- Phase 10: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html`
- Worker: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

Development login allowlist now includes:

- `test0101,test0202,test0303,test0404,test0505,test0606,test0707`

Normal production login remains disabled. No production CNAME is configured for V2 development.

D1 tables now include:

- `lesson_entitlements`
- `student_sessions`
- `curriculum_start_points`
- `answer_view_tokens`
- `answer_password_rate_limits`
- `mock_password_rate_limits`

Existing single-active-session trigger remains `trg_student_sessions_single_active`.

## 8. Safety / deliberate non-actions

- Existing live portal repository/Worker/KVs remained untouched.
- No live-domain switch.
- No production CNAME on V2.
- Normal real-student V2 login remains disabled.
- No production catalogue import has begun.
- No Excel/VBA sync endpoint has begun.
- Phase 10 special-content architecture is proven with test-only V2 fixtures; real operational mock passwords or production special-content IDs were not copied, guessed or committed.
- **No Phase 11 work has started.**

## 9. Phase 10 closure

**PASS — PHASE 10 CLOSED.**

Phase 10 is complete for 11+ Maths Assessments, Year 5 11+ MOCKS/daily-password protection and VR How-To through the V2 manual special-access model, including the corrected available-lesson total and per-subject Current/Previous multi-year history navigation.

## 10. Next phase — Phase 11

Purpose: load the real lesson catalogue into the already-proven V2 architecture. Phase 11 must begin in a new chat and must not be started as part of the Phase 10 handover.

### Exact new-chat prompt

> Continue FPT Portal V2. Start Phase 11 only. Read the latest Master Authoritative Specification v2.7, Steps to Progression v1.7 and Implementation Handover v3.9 first. Reconnect to the GitHub repository FuturePerfectTuitions/futureperfect-lessons-v2 and inspect the actual current implementation and deployed V2 development state before changing anything. Phase 10 is complete. Load the real lesson catalogue only, preserving the canonical curriculum, student-facing Lesson ID aliases, Current/Previous Year/Level grouping per subject with independent Maths/English history, the student-facing available-lesson count rule (open ordinary lessons plus visible manually assigned special-area cards), explicit resource pairings, the 11+-only ScreenPal quiz rule, Phase 8 protected-answer model, Phase 9 English/VR model and Phase 10 manual special-access architecture. Use exact R2 object paths and explicit approved ScreenPal share/embed URLs; never guess URLs from bare IDs. Do not copy legacy KV permission logic into V2. Use the established guarded GitHub Actions → Cloudflare path where practical, never expose Cloudflare secrets, and for any remaining manual Cloudflare/KV/D1 step guide me as a beginner in small explicit steps. Do not change the existing live portal. Work on GitHub yourself. Complete and verify Phase 11 only; do not start Phase 12. At the end of Phase 11, include a practical ‘What you can now see on the portal’ summary and give me a test login/checklist before closing the phase.
