# FPT Portal V2 — Phase 9 Verification

Date: 22 August 2026  
Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`  
Scope: Phase 9 only — English core, English 11+ Verbal Reasoning, and 11+-only ScreenPal quiz gating.  
Existing live portal: unchanged.

## 1. Phase 9 implementation verified

Phase 9 extends the reusable lesson renderer and Worker contract for English while preserving one canonical core lesson record for both normal English and English 11+.

Verified implementation includes:

- normal English and English 11+ share the same canonical English core lesson record and curriculum entry;
- no duplicate 11+ core lesson record is required;
- current student-facing presentation (`normal` versus `11plus`) is authoritative for ScreenPal quiz visibility;
- normal English receives no quiz model, quiz metadata, quiz resource key, quiz URL or quiz route access;
- English 11+ receives the safe quiz model only;
- bare ScreenPal quiz IDs are not converted into guessed URLs;
- an 11+ quiz with no explicit ScreenPal share/embed URL returns `QUIZ_SHARE_URL_REQUIRED` rather than exposing or guessing a URL;
- ScreenPal quiz URLs are accepted only when HTTPS and on the approved ScreenPal host allowlist;
- Verbal Reasoning is nested under the canonical English lesson record;
- VR is rendered only in the English 11+ presentation;
- open VR access is controlled by permanent `vr_access` entitlement, manual VR access, or the appropriate English 11+ full-library grant;
- `vrEligible` is not used as a retroactive runtime entitlement gate;
- locked 11+ preview can expose the real VR/quiz structure and names without exposing usable resource keys, URLs or raw metadata;
- VR PreLesson sheets and VR Homework files use protected resource routes appropriate to their resource type;
- VR Answer Keys and VR Answer Packs reuse the Phase 8 per-open Answer Pack password and controlled PDF viewer model;
- VR protected answer access is rechecked against current 11+ presentation and current VR entitlement before Phase 8 protected-answer authorisation is allowed.

No new Phase 9 D1 schema was required. Existing `lesson_entitlements.core_access` and `lesson_entitlements.vr_access` remain authoritative.

## 2. Cloudflare development deployment

PASS

A scoped Cloudflare Account API Token was stored only as GitHub Actions repository secrets together with the Cloudflare Account ID. The token value was never committed to the repository.

A guarded GitHub Actions deployment path was added and verified. Before any write, it confirms:

- target Worker is exactly `fpt-portal-v2-worker`;
- Worker environment is `development`;
- allowed portal origin is `https://futureperfecttuitions.github.io`;
- expected V2 KV, D1 and R2 bindings are present;
- bound R2 bucket is the development materials bucket;
- Phase 8 protected-answer baseline signatures are present;
- Phase 9 fixture preconditions match the audited development state;
- Wrangler dry-run succeeds before deployment.

The runtime Wrangler configuration is generated inside the GitHub runner from the already-bound V2 development resources rather than committing Cloudflare resource identifiers to the repository.

Phase 9 was deployed successfully to the isolated V2 development Worker. The existing live portal was not targeted.

Development login allowlist after deployment:

- `test0101`
- `test0202`
- `test0303`
- `test0404`

## 3. Phase 9 development fixtures

PASS

Canonical lesson fixture:

- lesson ID: `DEV-P9-ENGLISH`
- student-facing display ID: `Y5T3E99`
- subject: English
- same canonical lesson used by `english-year5` and `english-year5-11plus`
- ScreenPal quiz sentinel: `DEV-P9-QUIZ-SENTINEL`
- one VR PreLesson pair plus protected Answer Key
- VR PreLesson video
- one VR Homework pair plus protected Answer Pack
- VR Homework Solution video

The existing `curriculum:ENGLISH_Y5` value was inspected before modification and `DEV-P9-ENGLISH` was appended idempotently rather than replacing the existing curriculum.

Normal-English persona:

- `test0202`
- core entitlement to `DEV-P9-ENGLISH`
- `core_access=1`
- `vr_access=0`

English 11+ persona:

- `test0404`
- batch `Y5E11DEV1`
- `core_access=1`
- `vr_access=1`

Post-write KV and D1 verification passed.

## 4. Automated student API acceptance tests

PASS

### Normal English — `test0202`

Verified against the deployed V2 Worker:

- login succeeds in development;
- Year 5 English exposes the canonical `DEV-P9-ENGLISH` lesson as `Y5T3E99`;
- lesson presentation is normal;
- core lesson resources remain available according to existing access rules;
- `lesson.quiz` is null;
- `lesson.vr` is null;
- direct quiz access is rejected with `QUIZ_NOT_AVAILABLE`;
- direct VR resource access is rejected;
- ordinary Answer Pack protection still rejects an incorrect password;
- correct current Answer Pack password authorises a protected view;
- protected view remains single-use as required by Phase 8.

### English 11+ — `test0404`

Verified against the deployed V2 Worker:

- login succeeds in development;
- Year 5 11+ exposes the same canonical `DEV-P9-ENGLISH` lesson as `Y5T3E99`;
- lesson presentation is `11plus`;
- safe ScreenPal quiz model is present;
- quiz resource does not expose a guessed URL;
- bare-ID fixture returns `QUIZ_SHARE_URL_REQUIRED` until an explicit share/embed URL is stored;
- entitled VR model is present;
- VR PreLesson, videos, Homework, protected Answer Key and protected Answer Pack are represented;
- VR protected Answer Key uses the current student Answer Pack password and controlled viewer route.

### VR entitlement separation negative test

PASS

For `test0404`, `vr_access` was temporarily changed from `1` to `0`.

Verified while `vr_access=0`:

- English 11+ core lesson remained accessible;
- ScreenPal quiz remained presentation-eligible because quiz gating is based on current 11+ presentation;
- VR model disappeared;
- direct VR resource access was rejected.

`vr_access` was then restored to `1` automatically and the restoration was verified.

This demonstrates that `vrEligible`/11+ routing does not substitute for permanent VR entitlement.

## 5. Real Chrome browser acceptance

PASS

A headless Google Chrome acceptance test was run against the actual GitHub Pages Phase 9 portal:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase9.html`

### Normal English browser test

Verified:

- normal-English student login;
- Year 5 English navigation;
- `Y5T3E99` opens successfully;
- shared core lesson renders;
- ScreenPal Quiz section is not rendered;
- Verbal Reasoning section is not rendered;
- existing Phase 8 `Open Answer Pack` UI is present;
- protected Answer Pack modal retains the prompt-every-open wording.

### English 11+ browser test

Verified:

- English 11+ student login;
- Year 5 11+ navigation;
- same `Y5T3E99` canonical core lesson renders;
- ScreenPal Quiz section renders after the main Lesson Video and before Homework;
- Verbal Reasoning renders after Other Resources;
- VR structure contains PreLesson, PreLesson Video, Homework, Homework Solution Video, Answer Key and Answer Pack;
- bare-ID quiz remains safely gated until an explicit ScreenPal share/embed URL is supplied;
- protected VR Answer Key opens through the controlled PDF.js viewer using the current Answer Pack password;
- protected viewer renders the PDF without exposing normal browser PDF download/print controls;
- closing and reopening the same VR protected answer prompts for the password again and does not retain the prior password;
- VR PreLesson video endpoint resolves to the approved ScreenPal player URL.

The final Chrome workflow completed successfully and browser screenshots were captured as GitHub Actions artifacts.

## 6. Regression and safety checks

PASS

- Phase 7 and Phase 8 core source behaviour remains composed underneath Phase 9 rather than duplicated.
- Phase 8 protected-answer token model remains in use for ordinary Answer Packs and protected VR answers.
- no Phase 9 D1 schema migration was introduced;
- no raw R2 paths are exposed through the safe Phase 9 lesson model;
- normal-stream students do not receive 11+ quiz metadata/resources;
- normal-stream students do not receive VR metadata/resources;
- direct endpoint access is re-authorised server-side rather than relying on frontend hiding;
- development fixture changes are isolated to V2 development data;
- existing live portal was not modified.

## 7. Phase 9 checkpoint

PASS

Phase 9 is technically complete.

The checkpoint has been demonstrated at three levels:

1. static/source validation;
2. deployed Worker/KV/D1 API acceptance tests, including negative entitlement tests;
3. real Chrome rendering and protected-view behaviour against the GitHub Pages development portal.

Phase 9 therefore satisfies the agreed English core, English 11+ Verbal Reasoning, quiz-gating and protected-VR requirements.

Do not begin Phase 10 as part of this checkpoint.
