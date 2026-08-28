# Phase 15 — student persona acceptance matrix

Status: **MATRIX DEFINED — TESTING NOT YET STARTED**

Starting checkpoint: merged `main` `525a496ef39f43dfd60241e5f031ea96b451151e` (PR #124). Phase 14 is CLOSED/PASS. Phase 15 is testing-only unless a blocking defect is proved. Phase 16 is out of scope.

This matrix is intentionally written before Phase 15 persona execution. It preserves the locked 369-lesson / 11-curriculum catalogue and its accepted hash, permanent/idempotent Student + Lesson entitlement identity, separate Batch + Lesson operational context, effective-dated subject-specific assignments, Current/Previous history, protected answers, ordinary/11+ presentation, Full Library, special-area gates and the existing production-isolation rules.

No password, secret, account ID, private credential, real-student record or resource URL belongs in Phase 15 evidence.

## Evidence classes

- **R — read-only established development persona:** reuse an already-authorised development/test persona and make no entitlement/membership mutation.
- **F — controlled Phase 15 fixture:** create only after exact absence guards; use only in isolated development; restore every touched D1/KV/session row to the pre-test state; then prove the documented baseline again.
- **S — static/inherited regression:** rerun accepted tests/code-policy checks where a live destructive rewrite would add no evidence.
- **O — owner/browser acceptance:** render the student-facing development UI and verify the persona result at browser level without enabling normal production login.

## Complete persona matrix

| ID | Evidence | Persona / state | Current + Previous / catalogue | Entitlement + membership behaviour | Ordinary / 11+ / VR presentation | Full Library / special areas | Session + protected answer gates | Required Phase 15 result |
|---|---|---|---|---|---|---|---|---|
| P01 | R+O | Ordinary Maths only | Current ordinary Maths; same-year English locked preview; full current catalogue semantics | Existing Student+Lesson access only | Ordinary Maths Year terminology; ordinary video; no interactive quiz | No special-area leakage | Login/session + protected answer regression | Maths opens only where entitled; English preview leaks no gated identifiers; no 11+ UI |
| P02 | R+O | Ordinary English only, non-VR | Current ordinary English; same-year Maths locked preview | Existing Student+Lesson access only | Ordinary English; no VR; no interactive quiz | No VR How-To / Assessments / MOCKS leakage | Login/session + protected answer regression | English behaves as ordinary; VR remains absent; locked Maths preview safe |
| P03 | R+O | Ordinary Maths + English | Both subjects Current; histories remain independent | No cross-subject entitlement synthesis | Both presentations ordinary | No special-area leakage | Protected answer tested on representative resource | Both subject views open independently; no mirrored history |
| P04 | R+O | Maths 11+ | Current Maths Level presentation; opposite-subject preview remains safe | Existing permanent access | Level terminology; authorised 11+ interactive quiz replaces Lesson Video presentation where configured | Assessment/MOCKS absent unless separately manually granted | Protected answer + session regression | 11+ Maths gets only authorised 11+ presentation; ordinary-only resources are not substituted |
| P05 | R+O | English 11+ with VR | Current English 11+; safe locked Maths preview where applicable | Existing core + VR entitlement | Shared English core plus VR; authorised 11+ quiz; all ordinary VR lesson videos suppressed | VR How-To remains separate and only visible if separately manually granted | Protected answer + session regression | VR is visible only in eligible 11+ context; no VR teaching/solution videos are exposed |
| P06 | R+O | English 11+ without VR entitlement | Current English 11+ | Core entitlement does not imply VR entitlement | 11+ shell/quiz allowed, VR lesson resources denied | VR How-To denied unless separately granted | Normal protected-answer behaviour | Core English works while VR remains gated |
| P07 | R+O | Dual 11+ Maths + English with VR | Current Maths Level + English 11+ | Subject entitlements remain independent | 11+ Maths + 11+ English; VR only on English-authorised resources | No special cards without manual access | Session + answer regressions across both subjects | Correct simultaneous 11+ views with no cross-subject leakage |
| P08 | R+O | Retained historical access with present current programme | Previous generated only from earned access; Current generated only from current configuration | Previously earned Student+Lesson rows persist | Historical presentation retains the earned normal/11+ form where source evidence determines it | Special access is not manufactured by history | Session access to retained lessons remains protected normally | Current/Previous grouping changes presentation only and never grants or revokes entitlement |
| P09 | F+O | Mid-term joiner: before join / at join / after join | Current view reflects effective membership only when active | No pre-join retroactive entitlement; entitlement on/after effective_from only | Presentation follows the assigned subject/stream | None unless explicitly granted | Session remains valid while fixture state changes | `effective_from` inclusive; earlier releases remain inaccessible; no automatic backfill |
| P10 | F+O | Transfer old batch → new batch | Old earned lessons remain Previous/open as appropriate; new active batch becomes Current | Old Student+Lesson survives; only future new-batch releases can be newly earned; no earlier new-batch inheritance | New stream presentation follows new batch; retained old access preserves its historical presentation | No special access side effect | Session survives ordinary transfer data changes; no auth mutation required | Transfer changes future release context, never deletes prior entitlement |
| P11 | F+O | Leave / rejoin | While outside a batch there is no active Current from that assignment; retained access remains historical; on rejoin Current returns | Leaving stops future release eligibility but earned Student+Lesson remains; rejoin restores use of retained access | Presentation derived from active configuration + retained evidence | No special side effect | Session/security unchanged | Entitlement count does not decrease across leave/rejoin |
| P12 | F+O | Stop one subject, continue another | Subject histories independent; continuing subject remains Current; stopped subject retains earned Previous access | No deletion of stopped-subject earned lessons while user remains active | No presentation mirroring across subjects | No special side effect | Session/security unchanged | Stopping one subject does not erase earned access in that subject |
| P13 | F+O | Full Library ordinary | Full Library creates/open view access without D1 Student+Lesson fabrication | Full Library overlap with direct entitlement deduplicates presentation; removing fixture Full Library restores prior state without deleting earned rows | Ordinary Full Library uses ordinary presentation | No special-area implication | Protected answer still requires per-open password | Full Library covers only its defined curriculum; no duplicate view/resource access |
| P14 | F+O | Full Library 11+ with VR | Full 11+ English library view | Full Library is access source, not permanent Student+Lesson insertion | 11+ English presentation; VR allowed only for the specific 11+ Full Library rule | VR How-To still separate/manual | Protected answer per-open | 11+ Full Library VR does not imply VR How-To or other special buckets |
| P15 | R/F+O | Manual 11+ Maths Assessments | Special cards appear only in mapped Maths Level | Manual special bucket does not create ordinary entitlement | No ordinary/VR presentation leakage | Y4 assessment buckets only under Level 2; Y5 only under Level 3 | Session required; special resource route gated | Assessment cards/resources require explicit recognised manual bucket and correct view |
| P16 | R/F+O | VR How-To eligible and ineligible controls | Separate top-level English option only for eligible Y4/Y5 11+ | Manual special access does not create ordinary/VR lesson entitlement | Not an ordinary VR lesson | `VR_HOWTO` visible only with recognised manual access + eligible 11+ view | Session required | Positive and negative gates both pass; no ordinary VR video-policy regression |
| P17 | R/F+O | Y5 11+ MOCKS eligible and ineligible controls | MOCKS card only under Maths Level 3 / English Y5 11+ when manually assigned | MOCKS remains separate from ordinary entitlement | Does not alter normal lesson presentation | Before unlock safe metadata only; daily password path separate from Answer Pack password | Session-scoped unlock model; wrong credential safe; no raw IDs/URLs while locked | Positive visibility + negative access/leak gates pass without exposing operational password |
| P18 | F | Secure opaque-session lifecycle | N/A | N/A | N/A | N/A | Cookie token is opaque; raw login password never becomes request auth; exactly one active session; second login revokes first; logout revokes current; inactivity expires at 2 hours | All session state transitions verified against API + D1 without printing token/password values |
| P19 | F | Login password reset effect | N/A | No lesson entitlement mutation | N/A | N/A | Admin-side controlled fixture password change/reset must not disclose password; old login credential fails; newer login uses one active session; any explicitly revoked pre-reset session fails | Reset test changes authentication only; no entitlement/catalogue/batch mutation |
| P20 | F | Protected Answer Pack / Key lifecycle | Representative entitled lesson only | No entitlement change | Same protection under ordinary and 11+ presentation | Independent of MOCKS credential | Password required every open; no remember-device; wrong password denied; capability short-lived/single-use; session revocation and current answer-password change invalidate prior capability; raw R2 URL never exposed | Every protected-answer invariant passes and test credentials/tokens are never logged |
| P21 | S+R | Locked catalogue preview / no-access control | Full catalogue visible where the Master requires a catalogue view; non-entitled lesson metadata is safe/locked | Preview must not create D1 entitlement | No gated quiz/VR/resource identifiers from locked item | No special access inferred | Session required to reach personalised view | Locked metadata only; opening/resource routes deny access; D1 unchanged |
| P22 | S+R | Real development baseline sanity | Two assigned real development users remain untouched; future-dated subject-specific assignments remain authoritative | 173 retained rows for the two assigned users; no fixture write to either user | No credential-based real-user testing is required | No private special access inference | General login remains disabled; do not request or print real credentials | Read-only counts/assignment integrity only; exact Phase 14 baseline survives Phase 15 |

## Cross-cutting acceptance assertions

1. **Catalogue lock:** 369 canonical lessons across 11 curricula and SHA256 `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663` remain unchanged.
2. **Permanent identity:** every fixture test proves Student + Lesson is idempotent and permanent; Batch + Lesson remains separate operational release context.
3. **Effective dates:** `effective_from` is inclusive and `effective_to` exclusive. Assignment alone never inserts/updates/deletes `lesson_entitlements`.
4. **No automatic revocation:** edits, transfer, leave, subject stop and fixture cleanup never delete an already-earned non-fixture Student + Lesson entitlement.
5. **Full Library:** access is evaluated as a separate access source and must not fabricate permanent entitlement rows. 11+ Full Library VR is limited to the recognised 11+ library rule.
6. **Protected answers:** no raw R2 URL; per-open password; controlled capability/view token; no remember-device; session/answer-password invalidation preserved.
7. **Presentation:** ordinary views never receive 11+ interactive quizzes; authorised 11+ contexts use the interactive quiz in the Lesson Video slot; current policy exposes no VR PreLesson/Homework-solution videos.
8. **Special buckets:** only recognised manual buckets may expose Assessments, `VR_HOWTO`, or `MOCKS`; these do not become ordinary Excel entitlements.
9. **Session security:** secure opaque cookie, 2-hour inactivity, exactly one active session per Portal User ID, logout/revocation, reset-effect checks.
10. **Excel regression:** Phase 15 does not change `SyncPortalEntitlements`, selected-row-only processing, C/N/Q/T semantics, exact Email Database resolution, status-font semantics, or membership rules.
11. **Isolation:** `ENVIRONMENT=development`, development R2 only, normal production student login disabled, no DNS/CNAME/production route/live-portal change, no legacy `FPT_LESSONS_TEST` binding.
12. **Cleanup:** start and finish at exactly 632 `lesson_entitlements`, 4 `batch_definitions`, 4 `student_batch_assignments`, 0 `batch_lesson_releases`; two assigned real development users retain 173 entitlements; Phase 15 fixture rows/keys/sessions are absent; `PRAGMA quick_check=ok`; `trg_student_sessions_single_active` exists.

## Execution order

1. Read-only preflight and static regression.
2. Read-only established-persona API/browser pass (P01–P08, P21–P22).
3. Guarded controlled-fixture setup only after exact absence and baseline assertions.
4. Effective-date/history/permanence scenarios (P09–P12).
5. Full Library and special-content positive/negative scenarios (P13–P17).
6. Session/reset/protected-answer lifecycle (P18–P20).
7. Unconditional guarded cleanup of Phase 15 fixtures.
8. Final read-only baseline/catalogue/security regression.
9. Owner/browser acceptance evidence.
10. Only if every blocking gate passes, update Phase 15 closure evidence and merge a Phase 15 PR. Do not begin Phase 16.
