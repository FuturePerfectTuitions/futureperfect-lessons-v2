# Phase 15 — student persona acceptance matrix

Status: **MATRIX DEFINED — TESTING NOT YET STARTED**

Starting checkpoint: merged `main` `525a496ef39f43dfd60241e5f031ea96b451151e` (PR #124). Phase 14 is CLOSED/PASS. Phase 15 is testing-only unless a blocking defect is proved. Phase 16 is out of scope.

This matrix was completed before Phase 15 persona execution. It preserves the locked 369-lesson / 11-curriculum catalogue and accepted hash, permanent/idempotent Student + Lesson identity, separate Batch + Lesson operational context, effective-dated subject-specific assignments, Current/Previous history, protected answers, ordinary/11+ presentation, Full Library, special-area gates and production-isolation rules.

No password, secret, account ID, private credential, real-student record or resource URL belongs in Phase 15 evidence.

## Evidence classes

- **R — read-only established development persona:** reuse an already-authorised development/test persona and make no entitlement/membership mutation.
- **F — controlled Phase 15 fixture:** create only after exact absence guards; isolated development only; restore every touched D1/KV/session row to the pre-test state and prove the documented baseline again.
- **S — static/inherited regression:** rerun accepted tests/code-policy checks where a live destructive rewrite would add no evidence.
- **O — owner/browser acceptance:** render the student-facing development UI and verify the persona result at browser level without enabling normal production login.

## Complete persona matrix

| ID | Evidence | Persona / state | Required Phase 15 result |
|---|---|---|---|
| P01 | R+O | Ordinary Maths only | Current ordinary Maths uses Year terminology and ordinary video; entitled lessons open; same-year English locked preview is safe; no 11+ quiz/special leakage. |
| P02 | R+O | Ordinary English only, non-VR | Ordinary English opens independently; VR and 11+ quiz remain unavailable; locked Maths preview is safe. |
| P03 | R+O | Ordinary Maths + English | Both subjects are independently Current; histories do not mirror; no cross-subject entitlement synthesis. |
| P04 | R+O | Maths 11+ | Maths uses Level terminology; authorised 11+ quiz presentation replaces the normal Lesson Video slot where configured; ordinary-only presentation is not substituted. |
| P05 | R+O | English 11+ with VR | Shared English core + authorised VR are visible; 11+ quiz gate passes; VR PreLesson/Homework-solution videos remain suppressed; VR How-To remains separate. |
| P06 | F+O | English 11+ without VR entitlement | 11+ shell/core/quiz may be present while VR lesson access remains gated; core entitlement must not imply VR entitlement or VR How-To. |
| P07 | R+O | Dual 11+ Maths + English with VR | Correct simultaneous 11+ Maths and English views; VR only on authorised English resources; no cross-subject leakage. |
| P08 | R+O | Retained historical access plus current programme | Current comes only from active configuration; Previous comes only from earned history; grouping never creates/revokes entitlement. |
| P09 | F+O | Mid-term joiner: before join / at join / after join | Assignment alone creates no backfill; pre-join release is denied; `effective_from` is inclusive; on/after join release can create exactly one Student + Lesson entitlement. |
| P10 | F+O | Transfer old batch → new batch | Old earned lessons remain open/history; future new-batch releases can be earned; earlier new-batch lessons are not inherited; no old entitlement is deleted. |
| P11 | F+O | Leave / rejoin | Leaving stops future batch eligibility but earned access remains; rejoin restores Current configuration without deleting/recreating earlier Student + Lesson rows. |
| P12 | F+O | Stop one subject, continue another | Continuing subject remains Current; stopped subject retains earned Previous access; Maths/English histories remain independent. |
| P13 | F+O | Full Library ordinary | Full Library opens only its defined curriculum, does not fabricate D1 Student + Lesson rows, deduplicates overlap and still requires per-open protected-answer authentication. |
| P14 | F+O | Full Library 11+ with VR | Recognised 11+ English Full Library grants the corresponding 11+ view and VR rule only; it does not imply VR How-To, Assessments or MOCKS. |
| P15 | R/F+O | Manual 11+ Maths Assessments | Recognised assessment buckets appear only at the authorised Maths Level; no ordinary entitlement or unrelated special access is created. |
| P16 | R/F+O | VR How-To eligible and ineligible controls | `VR_HOWTO` is a separate English option only with recognised manual access and eligible Y4/Y5 11+ context; positive and negative gates both pass. |
| P17 | R/F+O | Y5 11+ MOCKS eligible and ineligible controls | MOCKS appears only in authorised Y5 11+ Maths Level 3 / English Year 5 11+ views with manual access; locked payload leaks no usable URL/key; wrong credential is safe; MOCKS credential model remains separate from Answer Pack password. |
| P18 | F | Secure opaque-session lifecycle | Browser receives an opaque token; D1 stores only its hash; exactly one active session exists; second login revokes first; logout revokes current; 2-hour inactivity expires the session. |
| P19 | F | Login password reset effect | Controlled test-only password reset changes authentication only; the prior credential fails after reset, pre-reset session is explicitly revoked, and entitlement/catalogue/batch state is unchanged; original fixture state is restored exactly. |
| P20 | F | Protected Answer Pack / Key lifecycle | Password is required every open; wrong/no password is denied; capability is opaque, short-lived and single-use; session revocation and answer-password change invalidate it; raw R2 URL is never exposed. |
| P21 | S+R | Locked catalogue preview / no-access control | Full catalogue remains visible where required; non-entitled lesson metadata is safe/locked; resource/open routes deny access and do not create entitlement. |
| P22 | S+R | Real development baseline sanity | Two assigned real development users remain untouched; 173 retained rows and four future-dated assignments remain intact; no real credential testing; normal production login remains disabled. |
| P23 | S+F | Absence while still assigned | Absence is not a membership-removal operation. Release eligibility remains governed by the effective assignment; no attendance state may silently suppress an otherwise valid assigned release. |
| P24 | F+O | One-off guest / manual individual lesson access | Exactly the specified lesson may be granted/opened without changing the regular batch assignment; no additional lessons or retroactive batch access appear; fixture cleanup removes only access proven absent before test. |
| P25 | F+O | Multiple simultaneous active batches in one subject | Every distinct active year/stream view in the same subject is grouped **Current**; retained non-active access is Previous. Multiple active assignments must not be collapsed into one Current view. |

## Cross-cutting acceptance assertions

1. **Catalogue lock:** 369 canonical lessons across 11 curricula and SHA256 `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663` remain unchanged.
2. **Permanent identity:** Student + Lesson remains idempotent/permanent; Batch + Lesson remains separate operational release context.
3. **Effective dates:** `effective_from` is inclusive and `effective_to` exclusive. Assignment alone never inserts/updates/deletes `lesson_entitlements`.
4. **No automatic revocation:** transfer, leave, subject stop, source edits and persona changes never delete an already-earned non-fixture Student + Lesson entitlement.
5. **Full Library:** separate access source; no permanent D1 entitlement fabrication; 11+ Full Library VR is limited to its recognised 11+ rule.
6. **Protected answers:** no raw R2 URL; per-open password; controlled capability/view token; no remember-device; session/answer-password invalidation preserved.
7. **Presentation:** ordinary views never receive 11+ interactive quizzes; authorised 11+ contexts use the quiz in the Lesson Video slot; current policy exposes no VR PreLesson/Homework-solution videos.
8. **Special buckets:** only recognised manual buckets expose Assessments, `VR_HOWTO` or `MOCKS`; they do not become ordinary Excel entitlements.
9. **Session security:** secure opaque cookie, 2-hour inactivity, exactly one active session per Portal User ID, logout/revocation and reset-effect checks.
10. **Excel regression:** Phase 15 does not change `SyncPortalEntitlements`, selected-row-only scope, C/N/Q/T semantics, exact Email Database resolution, status-font semantics or membership rules.
11. **Isolation:** `ENVIRONMENT=development`, development R2 only, normal production student login disabled, no DNS/CNAME/production route/live-portal change, no legacy `FPT_LESSONS_TEST` binding.
12. **Cleanup:** start and finish at exactly 632 `lesson_entitlements`, 4 `batch_definitions`, 4 `student_batch_assignments`, 0 `batch_lesson_releases`; two assigned real development users retain 173 entitlements; Phase 15 fixture rows/keys/sessions are absent; `PRAGMA quick_check=ok`; `trg_student_sessions_single_active` exists.
13. **Same-subject multiplicity:** multiple simultaneously active subject assignments remain Current together; Current/Previous is presentation only.
14. **Guest/absence:** neither absence nor a one-off individual release mutates batch membership.

## Execution order

1. Read-only preflight and static regression.
2. Read-only established-persona API/browser pass (P01–P08, P15–P17, P21–P23).
3. Guarded controlled-fixture setup only after exact absence and baseline assertions.
4. Effective-date/history/permanence/multiple-active scenarios (P09–P12, P25).
5. Full Library, guest/manual and special-content scenarios (P13–P17, P24).
6. Session/reset/protected-answer lifecycle (P18–P20).
7. Unconditional guarded cleanup of Phase 15 fixtures.
8. Final read-only baseline/catalogue/security regression.
9. Owner/browser acceptance evidence.
10. Only if every blocking gate passes, update Phase 15 closure evidence and merge a Phase 15 PR. Do not begin Phase 16.
