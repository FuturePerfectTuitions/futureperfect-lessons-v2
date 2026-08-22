# FPT Portal V2 — Implementation Handover

**Cumulative version:** 3.8  
**Updated:** 22 August 2026  
**Completed through:** Phase 10 — Existing Special Content Areas

**STATUS: PHASES 1–10 COMPLETE · PHASE 11 MUST START IN A NEW CHAT**

## 1. Governing authority

Use this file together with:

1. **Master Authoritative Specification v2.6 (22 August 2026)** — business/workflow authority;
2. **Steps to Progression v1.6 (22 August 2026)** — phase sequence/checkpoint authority;
3. **this cumulative handover v3.8** — actual implementation state completed through Phase 10;
4. the actual current GitHub and deployed Cloudflare V2 state whenever exact code/deployment state matters.

The existing live portal remains separate and must not be changed to solve V2 problems.

## 2. Permanent working rules

### 2.1 Phase boundary

- Finish and verify the current phase completely.
- Update the cumulative handover after the tested implementation is complete.
- Stop after the handover.
- Every new phase starts in a new chat.
- At the start of that chat: read Master + Steps + Handover, reconnect to GitHub, inspect the current implementation and deployed V2 development state, then begin work.

### 2.2 Cloudflare / GitHub operations

- Sej is a beginner with Cloudflare/KV/D1 operations; any remaining manual dashboard step must be small and explicit.
- Prefer the established GitHub Actions → Cloudflare guarded path for V2 audit/apply work where practical.
- Cloudflare credential values must never be pasted into chat or committed to GitHub.
- The repository secrets remain `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; their values are not recorded here.
- The Phase 10 daily mock password is stored only through Worker secret/config `MOCK_DAILY_PASSWORDS`; its value is not recorded here.
- Never target the existing live portal from a V2 workflow.

## 3. Cumulative build status

| Phase | Status | Implementation state |
|---|---|---|
| 1 | COMPLETE | Isolated GitHub Pages + V2 Worker + Students KV + Lessons KV + D1 + R2. |
| 2 | COMPLETE | V2 data foundations and idempotent Student + Lesson entitlement model. |
| 3 | COMPLETE | One complete real-shaped Maths lesson through protected Answer Pack proof. |
| 4 | COMPLETE | Secure opaque sessions, 2-hour inactivity, logout and single-device login. |
| 5 | COMPLETE | FPT visual shell and Maths/English student entry. |
| 6 | COMPLETE | Worker-authoritative Year/Level navigation, locked previews and 11+ start-point behaviour. |
| 7 | COMPLETE | Reusable ordinary lesson-page renderer and Worker-gated resources. |
| 8 | COMPLETE | Per-open Answer Pack/Answer Key protection and controlled PDF.js viewer. |
| 9 | COMPLETE | Shared English core + English 11+ VR + 11+-only ScreenPal quiz gate. |
| 10 | COMPLETE | 11+ Maths Assessments + Y5 11+ MOCKS/daily password + VR How-To through manual special access. |
| 11 | NEXT | Load the real lesson catalogue. Do not begin inside the Phase 10 chat. |

## 4. Core architecture carried forward through Phase 9

### 4.1 Authentication / navigation

- Username comparison is case-insensitive.
- Browser receives an opaque secure session rather than retaining the student's raw password.
- Two-hour inactivity timeout remains enforced.
- Exactly one active session per Portal User ID remains enforced; the latest successful login wins.
- Normal production student login remains disabled during development.
- Top-level student subjects remain exactly **Maths** and **English**.
- Maths uses Year terminology for normal streams and Level terminology for 11+ views.
- English normal and English 11+ share canonical core content by school year.

### 4.2 Ordinary lesson renderer

The completed ordinary lesson renderer remains:

- `phase7.html`
- `assets/phase7.js`
- `assets/phase7.css`
- `assets/phase7-upsell.js`

It supports:

- student-facing Lesson ID + title + description/topics;
- zero/one/many PreLesson Sheets;
- zero/one main ScreenPal lesson video;
- zero/one/many Homework items;
- explicit Homework → Answer Pack pairing;
- optional Other Resources;
- hidden empty sections;
- Worker-authorised resource delivery;
- safe cross-subject locked previews.

### 4.3 Protected answers

Phase 8 remains composed underneath later phases:

- `worker/src/index-phase8.js`
- `phase8.html`
- `assets/phase8.js`
- `assets/phase8.css`

Protected Answer Packs and Answer Keys:

- prompt for the current personal Answer Pack password on every open;
- use the controlled PDF.js/canvas viewer;
- do not expose a raw R2 answer URL;
- display the student/FPT watermark/header;
- use short-lived single-use answer-view capabilities;
- are invalidated by session revocation or Answer Pack password change.

D1 Phase 8 security tables remain:

- `answer_view_tokens`
- `answer_password_rate_limits`

### 4.4 Phase 9 English / VR / quiz model

Phase 9 remains:

- `worker/src/index-phase9.js`
- `phase9.html`
- `assets/phase9.js`
- `assets/phase9.css`

Authoritative behaviour retained:

- normal English and English 11+ use one canonical core lesson;
- 11+ English may add nested Verbal Reasoning resources;
- VR protected Answer Keys/Packs reuse the Phase 8 current personal Answer Pack password;
- ScreenPal quiz metadata is exposed only in an authorised 11+ presentation;
- normal Maths/English views receive no quiz model/metadata/usable route even if the canonical lesson carries quiz metadata;
- quiz eligibility comes from the current 11+ presentation context, not `vrEligible` alone;
- a bare quiz ID is never guessed into a URL; an openable quiz requires an approved explicit HTTPS ScreenPal share/embed URL.

## 5. Phase 10 — Completed implementation

### 5.1 Purpose and separation from ordinary lessons

Phase 10 adds only the three special-content families that sit outside ordinary Maths/English lesson packages:

- 11+ Maths Assessments;
- Year 5 11+ Mock Tests / answer videos;
- VR How-To.

They are implemented as a separate special-content layer rather than adding page-specific branches to the ordinary lesson renderer.

Phase 10 Worker:

- `worker/src/index-phase10.js`

Phase 10 proof frontend:

- `phase10.html`
- `assets/phase10.js`
- `assets/phase10.css`

The Worker composition is now:

`Phase 10 → Phase 9 → Phase 8 → Phase 7 → base V2 Worker`

### 5.2 Authoritative special-access model

The student KV control point is:

`manualAccess.specialBuckets`

Recognised Phase 10 codes:

- `Y4MAssT1`
- `Y4MAssT2`
- `Y5MAssT1`
- `Y5MAssT2`
- `VR_HOWTO`
- `MOCKS`

Ordinary Excel/D1 `lesson_entitlements` do **not** grant these special areas.

Special catalogue key family:

- `special:<SPECIAL_BUCKET_CODE>`

This preserves the useful business-facing special codes while avoiding the legacy ordinary KV range/bucket entitlement architecture.

### 5.3 Navigation mapping

| Special code | V2 student location |
|---|---|
| `Y4MAssT1`, `Y4MAssT2` | Maths → Level 2 |
| `Y5MAssT1`, `Y5MAssT2` | Maths → Level 3 |
| `VR_HOWTO` | English → Year 4 11+ / Year 5 11+ |
| `MOCKS` | Maths → Level 3 and English → Year 5 11+ |

- VR How-To is not a third top-level subject.
- Special areas are not surfaced through cross-subject locked previews.
- Server-side special routes re-check the current session, manual special bucket and permitted open V2 view.

### 5.4 Student API routes

Phase 10 adds:

- `GET /api/v1/student/special-areas?viewId={viewId}`
- `GET /api/v1/student/special-areas/{bucketId}?viewId={viewId}`
- `GET /api/v1/student/special-resources/{resourceKey}/video?viewId={viewId}`
- `POST /api/v1/student/special-areas/MOCKS/mock-days/{day}/unlock?viewId={viewId}`

### 5.5 Year 5 11+ MOCKS daily-password model

MOCKS remains a manually assigned Year 5 11+ special area containing both Maths and VR answer videos.

Operational rule retained:

- one password for a mock day unlocks both that day's Maths answer video and VR answer video;
- daily mock password is separate from the student's personal Answer Pack password;
- browser-session unlock is retained only for already-authorised returned videos;
- logout clears the Phase 10 browser-session mock unlock state.

Security improvement over the legacy reference:

- the locked mock payload exposes safe display metadata only;
- no locked ScreenPal ID, ScreenPal URL, embed URL or usable video resource key is sent before successful daily-password verification;
- successful verification returns only authorised approved ScreenPal player URLs for that day.

Daily passwords are read from Worker secret/config:

- `MOCK_DAILY_PASSWORDS`

The value must never be committed to GitHub or written into handover documents.

Short-lived guessing protection uses new D1 table:

- `mock_password_rate_limits`

Migration:

- `worker/migrations/0006_mock_password_rate_limits.sql`

This table is security/ephemeral state only; it creates no access entitlement.

### 5.6 Phase 10 test-only fixtures

Test-only special records are stored in:

- `worker/fixtures/phase10/`

They use development sentinel ScreenPal IDs, not real legacy production special-content IDs/passwords.

Phase 10 personas:

- `test0505` — Year 5 11+ Maths + English with `Y5MAssT1`, `Y5MAssT2`, `VR_HOWTO`, `MOCKS`;
- `test0606` — Year 4 11+ Maths + English with `Y4MAssT1`, `Y4MAssT2`, `VR_HOWTO`.

Post-deploy D1 verification confirmed both personas have **zero** ordinary `lesson_entitlements` rows. Their special access therefore proves the manual special-access path rather than accidental Excel lesson entitlement.

Existing `test0404` is the Phase 10 negative-control persona: English 11+ without a Phase 10 special bucket; special access is absent/rejected.

## 6. Phase 10 GitHub / Cloudflare implementation

### 6.1 Static verification and implementation merge

Workflow:

- `.github/workflows/phase10-static-verification.yml`

Result: **PASS**.

Implementation PR:

- PR #8 — `Phase 10: add manual special content areas`

Implementation merge commit:

- `a83743f08d7516649b4dba336a6385fc019095b0`

### 6.2 Guarded V2 Cloudflare apply

Workflow:

- `.github/workflows/phase10-cloudflare-apply.yml`

The workflow verifies the exact V2 development Worker/environment/origin/bindings and the Phase 9 security baseline before any write, then performs a Wrangler dry run.

Guarded apply / acceptance run:

- GitHub Actions run `32567604924`

Result: **PASS**.

The workflow successfully:

- applied migration `0006_mock_password_rate_limits.sql`;
- deployed the Phase 10 Worker to `fpt-portal-v2-worker`;
- generated a random development-only mock password inside GitHub Actions, masked it and stored it in `MOCK_DAILY_PASSWORDS` without disclosing it;
- seeded the test-only Phase 10 special catalogues and test personas;
- re-read and compared the written KV fixtures;
- verified the D1 throttle table;
- verified zero ordinary lesson entitlement rows for `test0505`/`test0606`;
- retained Phase 8 answer-protection and Phase 9 quiz-gating markers;
- ran deployed API acceptance;
- ran real Google Chrome acceptance against the GitHub Pages Phase 10 portal.

Trigger-only operations PR:

- PR #9 — `Phase 10: guarded V2 Cloudflare apply`

Operations merge commit:

- `a5e00ccf3d972d8b072db0b77281597500114fca`

No existing live portal target was permitted by this workflow.

## 7. Phase 10 verification results

Detailed record:

- `docs/data/PHASE10_VERIFICATION.md`

### 7.1 Deployed API acceptance

**PASS**

Verified:

- Year 5 Level 3 receives only manually assigned Y5 assessment/MOCKS areas;
- Year 5 11+ English receives manually assigned VR How-To/MOCKS areas;
- Year 4 Level 2 receives manually assigned Y4 assessments;
- Year 4 11+ English receives manually assigned VR How-To;
- special-list response records manual special-bucket access and no Excel entitlement use;
- locked MOCKS response contains names/day/subject but no usable ScreenPal/video references;
- wrong daily password is rejected;
- correct daily password returns both Maths + VR answer videos for the same day;
- assessment and VR How-To video routes enforce their permitted view + manual special access;
- a 11+ student without the special bucket receives no special area/direct access.

### 7.2 Real Chrome acceptance

**PASS**

Verified against:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html`

Chrome proof covered:

- Level 3 assessment/MOCKS cards;
- locked Mock 1 with Maths + VR answer-video display names;
- incorrect password message;
- successful same-day Maths + VR unlock;
- ScreenPal player access only after unlock;
- Year 5 11+ English VR How-To/MOCKS placement;
- VR How-To resource rendering.

Four screenshots were saved as the GitHub Actions artifact `phase10-browser-screenshots` for the successful verification run.

## 8. Current GitHub / development state

Repository:

- `FuturePerfectTuitions/futureperfect-lessons-v2`
- branch: `main`

Development proof URLs:

- Phase 7: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase7.html`
- Phase 8: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase8.html`
- Phase 9: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase9.html`
- Phase 10: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html`
- Worker: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

No production `CNAME` is configured for V2 development.

## 9. Current Cloudflare / storage state

### 9.1 Worker

- Worker: `fpt-portal-v2-worker`
- Environment: `development`
- Allowed portal origin: `https://futureperfecttuitions.github.io`
- Development login allowlist: `test0101,test0202,test0303,test0404,test0505,test0606`
- Normal production student login: disabled
- Existing binding names remain: `STUDENTS_KV`, `LESSONS_KV`, `MATERIALS_R2`, `DB`
- Phase 10 Worker secret/config name: `MOCK_DAILY_PASSWORDS` — value deliberately not recorded.

### 9.2 Lessons KV

Existing ordinary key families remain:

- `lesson:<LESSON_ID>`
- `curriculum:<CURRICULUM_CODE>`
- legacy/proof `view:<VIEW_ID>` fallbacks retained during incremental development.

Phase 10 adds the V2 special family:

- `special:<SPECIAL_BUCKET_CODE>`

Current Phase 10 development special codes:

- `Y4MAssT1`
- `Y4MAssT2`
- `Y5MAssT1`
- `Y5MAssT2`
- `VR_HOWTO`
- `MOCKS`

### 9.3 D1

Database remains `fpt_portal_v2_db`.

Tables now include:

- `lesson_entitlements`
- `student_sessions`
- `curriculum_start_points`
- `answer_view_tokens`
- `answer_password_rate_limits`
- `mock_password_rate_limits`

Single-active-session trigger remains:

- `trg_student_sessions_single_active`

Phase 10 did not alter the permanent ordinary lesson entitlement schema.

## 10. Governing business / implementation rules carried forward

- The Master remains v2.6; Steps remains v1.6. Phase 10 implementation required no business-rule or phase-sequence revision.
- Cross-subject upsell content remains locked at access-control level; first explicit lock indication remains on the individual ordinary lesson page.
- ScreenPal quizzes remain 11+-only and presentation-gated.
- Protected ordinary/VR answers continue to use the student's current personal Answer Pack password and Phase 8 viewer.
- Special assessment/MOCKS/VR How-To access is manual through `manualAccess.specialBuckets`.
- Ordinary Excel Student + Lesson sync must not grant Phase 10 special areas.
- The mock daily password remains separate from the personal Answer Pack password.
- Locked mock metadata must never expose usable ScreenPal references before daily-password verification.
- Cloudflare V2 changes should continue to use audited/guarded GitHub Actions where practical.
- Secrets stay outside source control and chat.

## 11. Deliberate non-actions through Phase 10

- No changes to the existing live portal repository, Worker or live KV data.
- No live-domain switch.
- No production `CNAME` on V2.
- No normal production-student login enablement.
- No production lesson catalogue load.
- No real production Phase 10 special catalogue/password migration by guessing or inventing values.
- No Excel/VBA sync build yet.
- No Admin console.
- No Phase 11 work.

## 12. Phase 10 checkpoint

**PASS — Phase 10 is complete.**

The existing special-content use cases are reproducible in the isolated V2 development portal without depending on legacy ordinary KV range/bucket entitlement logic. Manual special access is separated from Excel lesson entitlement, Year 5 daily mock-password protection is preserved with stricter reference gating, and the deployed experience has passed API and real Chrome acceptance.

## 13. Next incomplete phase

### Phase 11 — Load the Real Lesson Catalogue

Do **not** start Phase 11 in the Phase 10 chat.

Phase 11 must begin in a new chat. Before changing anything, read Master v2.6, Steps v1.6 and this cumulative Implementation Handover v3.8; reconnect to GitHub and inspect the current implementation and deployed V2 development state.

## 14. New-chat start prompt

Continue FPT Portal V2. Start Phase 11 only. Read the latest Master Authoritative Specification v2.6, Steps to Progression v1.6 and Implementation Handover v3.8 first. Reconnect to the GitHub repository FuturePerfectTuitions/futureperfect-lessons-v2 and inspect the actual current implementation and deployed V2 development state before changing anything. Phase 10 is complete. Load the real lesson catalogue only, preserving the canonical curriculum, student-facing Lesson ID aliases, explicit resource pairings, 11+-only ScreenPal quiz rule, Phase 8 protected-answer model, Phase 9 English/VR model and Phase 10 manual special-access architecture. Use exact R2 object paths and explicit approved ScreenPal share/embed URLs; never guess URLs from bare IDs. Use the established guarded GitHub Actions → Cloudflare path where practical, never expose Cloudflare secrets, and for any remaining manual Cloudflare/KV/D1 step guide me as a beginner in small explicit steps. Do not change the existing live portal. Work on GitHub yourself. Complete and verify Phase 11 only; do not start Phase 12.
