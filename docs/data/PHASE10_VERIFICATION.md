# FPT Portal V2 — Phase 10 Verification

**Date:** 22 August 2026  
**Repository:** `FuturePerfectTuitions/futureperfect-lessons-v2`  
**Scope:** Phase 10 only — 11+ Maths Assessments, Year 5 11+ Mock Tests / answer videos with daily mock-password protection, and VR How-To.  
**Existing live portal:** unchanged.

## 1. Authority and scope

Phase 10 was implemented against Master Authoritative Specification v2.6, Steps to Progression v1.6 and cumulative Implementation Handover v3.7.

The authoritative Phase 10 rules retained are:

- special areas are manually assigned through `manualAccess.specialBuckets`;
- ordinary Excel/D1 Student + Lesson entitlements do not grant assessment, MOCKS or VR How-To access;
- 11+ Maths Assessments appear in the relevant Maths 11+ context;
- Year 5 11+ MOCKS are available only to manually assigned Year 5 11+ students;
- one daily mock password unlocks both Maths and VR answer videos for the same mock day;
- the daily mock password is separate from the student's personal Answer Pack password;
- locked mock metadata must not expose ScreenPal IDs, URLs or usable resource keys before password verification;
- VR How-To appears inside English 11+/VR rather than as a third top-level subject;
- the core Phase 7/8/9 lesson renderer is not repurposed into a special-content renderer.

No Phase 11 production catalogue work was started.

## 2. Implemented Phase 10 architecture

Phase 10 continues the established composition pattern:

`Phase 10 Worker → Phase 9 Worker → Phase 8 → Phase 7 → base V2 authentication/navigation`

New Worker entry layer:

- `worker/src/index-phase10.js`

New student proof page / frontend layer:

- `phase10.html`
- `assets/phase10.js`
- `assets/phase10.css`

The ordinary lesson renderer remains unchanged underneath Phase 10.

### 2.1 V2 special-area mapping

| Manual special bucket | V2 placement | Access model |
|---|---|---|
| `Y4MAssT1` | Maths → Level 2 | `manualAccess.specialBuckets` only |
| `Y4MAssT2` | Maths → Level 2 | `manualAccess.specialBuckets` only |
| `Y5MAssT1` | Maths → Level 3 | `manualAccess.specialBuckets` only |
| `Y5MAssT2` | Maths → Level 3 | `manualAccess.specialBuckets` only |
| `VR_HOWTO` | English → Year 4 11+ / Year 5 11+ | `manualAccess.specialBuckets` only |
| `MOCKS` | Maths → Level 3 and English → Year 5 11+ | `manualAccess.specialBuckets` only |

Special areas are not exposed through cross-subject locked previews.

### 2.2 Special catalogue storage

Phase 10 uses V2-owned catalogue records under:

- `special:Y4MAssT1`
- `special:Y4MAssT2`
- `special:Y5MAssT1`
- `special:Y5MAssT2`
- `special:VR_HOWTO`
- `special:MOCKS`

These are V2 special-content records. They do not restore the legacy ordinary lesson range/bucket entitlement model.

### 2.3 Student API contract

Added Phase 10 routes:

- `GET /api/v1/student/special-areas?viewId={viewId}`
- `GET /api/v1/student/special-areas/{bucketId}?viewId={viewId}`
- `GET /api/v1/student/special-resources/{resourceKey}/video?viewId={viewId}`
- `POST /api/v1/student/special-areas/MOCKS/mock-days/{day}/unlock?viewId={viewId}`

Every special route revalidates the current student session, manual special-bucket access and permitted current V2 view server-side.

## 3. MOCKS daily-password protection

The Phase 10 MOCKS contract was deliberately made safer than the legacy client-side model while preserving the operational behaviour.

Before successful password verification, the student may receive only safe mock metadata such as:

- mock day;
- title;
- subject;
- answer-video display name;
- locked state.

The locked payload does **not** include:

- ScreenPal IDs;
- ScreenPal URLs;
- embed URLs;
- usable video resource keys.

Daily passwords are stored in the V2 Worker secret/config value:

- `MOCK_DAILY_PASSWORDS`

The secret value is not committed to GitHub and is not recorded in this verification document.

For the isolated Phase 10 development acceptance run, GitHub Actions generated a random development-only password, masked it immediately, stored it as the Worker secret, used it for the acceptance test, and never printed its value.

A correct mock-day password returns the authorised Maths and VR answer videos for that day. The Phase 10 browser stores only the already-authorised returned video models in `sessionStorage` for the current browser session. Logout clears that browser-session unlock state.

Short-lived password guessing protection is provided by:

- `worker/migrations/0006_mock_password_rate_limits.sql`
- D1 table `mock_password_rate_limits`

The throttle state is ephemeral security state and does not create any lesson or special entitlement.

## 4. Development fixtures

Phase 10 uses explicitly test-only special catalogues with development ScreenPal sentinel IDs rather than copying real legacy production IDs or passwords into GitHub.

Test personas:

### `test0505`

- Year 5 11+ Maths + English development persona;
- manually assigned `Y5MAssT1`, `Y5MAssT2`, `VR_HOWTO`, `MOCKS`;
- no ordinary D1 lesson entitlement is required for special access.

### `test0606`

- Year 4 11+ Maths + English development persona;
- manually assigned `Y4MAssT1`, `Y4MAssT2`, `VR_HOWTO`;
- no ordinary D1 lesson entitlement is required for special access.

Existing `test0404` remains useful as the negative control: it is an English 11+ persona but has no Phase 10 special bucket, so direct VR How-To special access is rejected.

## 5. GitHub verification and guarded deployment

### 5.1 Static verification

Implementation PR #8 was verified by `.github/workflows/phase10-static-verification.yml` before merge.

Result: **PASS**.

Verified source items included:

- Phase 10 Worker JavaScript syntax;
- Phase 10 frontend JavaScript syntax;
- acceptance-test syntax;
- fixture JSON validity;
- Phase 10 Worker entrypoint;
- mock rate-limit migration;
- no committed daily mock password in the MOCKS fixture.

Implementation PR #8 was then merged to `main`.

Implementation merge commit:

- `a83743f08d7516649b4dba336a6385fc019095b0`

### 5.2 Guarded Cloudflare apply

Trigger-only PR #9 ran `.github/workflows/phase10-cloudflare-apply.yml`.

The workflow refused to write until it had verified:

- repository and trigger branch identity;
- exact target Worker `fpt-portal-v2-worker`;
- `development` environment;
- allowed development portal origin `https://futureperfecttuitions.github.io`;
- expected V2 `STUDENTS_KV`, `LESSONS_KV`, `MATERIALS_R2` and `DB` bindings;
- Phase 9 baseline security markers;
- Wrangler Phase 10 dry run.

All pre-write gates passed.

The workflow then:

1. applied only the Phase 10 mock-password throttle schema;
2. deployed `worker/src/index-phase10.js` to the isolated V2 Worker;
3. generated and stored the masked development-only `MOCK_DAILY_PASSWORDS` Worker secret;
4. seeded only the Phase 10 development special catalogues and test personas;
5. verified the written KV values against the repository fixtures;
6. verified the new D1 table;
7. verified `test0505` and `test0606` still have **zero** ordinary `lesson_entitlements` rows;
8. verified the deployed Worker still contains the Phase 9 quiz and Phase 8 answer-protection baseline markers.

Guarded apply / acceptance workflow run:

- GitHub Actions run `32567604924`

Result: **PASS**.

Trigger-only operations PR #9 was merged only after the full workflow passed.

Operations merge commit:

- `a5e00ccf3d972d8b072db0b77281597500114fca`

## 6. Deployed API acceptance

Result: **PASS**.

The deployed V2 Worker verified:

- `test0505` sees `Y5MAssT1`, `Y5MAssT2` and `MOCKS` in `maths-level3`;
- `test0505` sees `VR_HOWTO` and `MOCKS` in `english-year5-11plus`;
- special-list responses identify `manualAccess.specialBuckets` as the source and do not use Excel entitlement;
- locked MOCKS detail returns both Maths and VR video names for the day but no usable ScreenPal/video references;
- an incorrect daily password is rejected;
- the correct daily password returns both Maths and VR answer videos for that mock day;
- returned authorised video URLs resolve only to the approved ScreenPal player host pattern;
- manually assigned Year 5 assessment video access is authorised only in the permitted Maths 11+ view;
- VR How-To video access is authorised only in the permitted English 11+ view;
- `test0606` sees the Year 4 assessment buckets in `maths-level2` and VR How-To in `english-year4-11plus`;
- existing `test0404`, which has no Phase 10 special bucket, receives no special area and direct VR How-To special access is rejected.

Automated result emitted by the deployed suite:

`Phase 10 deployed API acceptance: PASS`

## 7. Real Chrome acceptance

Result: **PASS**.

A real headless Google Chrome acceptance test ran against:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html`

Verified in the rendered student experience:

- Year 5 Level 3 shows the manually assigned Year 5 11+ assessment and MOCKS cards;
- locked Mock 1 shows Maths and VR answer-video names without a loaded ScreenPal player;
- incorrect daily password shows a rejection message;
- correct daily password changes the mock day to unlocked and exposes exactly the Maths + VR Watch actions;
- the authorised Maths mock video resolves through the ScreenPal player only after unlock;
- Year 5 11+ English shows VR How-To and MOCKS;
- VR How-To opens and renders its manually assigned technique resources.

Automated result emitted by the browser suite:

`Phase 10 real Chrome acceptance: PASS`

Four Phase 10 browser screenshots were retained as a GitHub Actions artifact for the verification run.

## 8. Regression and safety checks

Result: **PASS**.

Confirmed:

- Phase 7 ordinary lesson renderer remains composed and was not converted into special-area page code;
- Phase 8 protected-answer architecture remains present;
- Phase 9 English VR and 11+-only quiz architecture remains present;
- special access does not depend on ordinary `lesson_entitlements`;
- Excel lesson sync cannot grant assessment/MOCKS/VR How-To merely by creating a Student + Lesson row;
- normal production student login remains disabled;
- no production `CNAME` was added;
- no real production special-content password was committed or disclosed;
- the existing live portal repository, Worker and KV resources were not targeted by the Phase 10 workflow.

## 9. Phase 10 checkpoint

**PASS — Phase 10 is complete.**

The required current special-content use cases are reproducible in V2 using the new manual special-access model without depending on the legacy ordinary bucket/range architecture. Daily mock-password protection is preserved with stricter server-side reference gating, and the Phase 10 checkpoint has been demonstrated through source verification, guarded deployed-state verification, deployed API acceptance and real Chrome rendering.

Stop here. Phase 11 must start in a new chat.
