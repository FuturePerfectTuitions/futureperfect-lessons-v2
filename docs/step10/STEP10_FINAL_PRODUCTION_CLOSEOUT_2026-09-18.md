# Step 10 — FINAL PRODUCTION CLOSEOUT

Date: 2026-09-18
Status: **CLOSED — PASS**
Scope: standalone 11+ Maths Practice application, Portal eligibility/launch bridge, final Portal card, timed-test final-minute rule, and floating timed-test countdown.

## Final production topology

- Portal Browser Worker: `fpt-portal-v2-rebuild-browser-prod`
  - active version: `8cf1f74c-1ed5-4f6d-8a98-68a79345ab6a`
  - live main bundle: `assets/portal-wK1OwW5J.js`
  - bundle SHA-256: `3907cb7782d070590c2f2c00bebb09fe80260de295e35b3dd1a41a8309e2cb5e`
  - exact frontend source SHA: `4a0a26090b1d119a7d6748d15eea3d7406513705`
  - rollback version: `f8a64bc8-8192-4400-9e45-8f1a1de10019`
  - rollback bundle: `assets/portal-CeIaLZ5y.js`
  - rollback bundle SHA-256: `9dc3203a012c1530216cba9f8362d227a46745249499362a3160310bb34f45dc`

- Portal Student Worker: `fpt-portal-v2-rebuild-student-prod`
  - active/accepted Gate D version: `f26167b1-073c-4015-912a-288a3d20e0bb`
  - unchanged during final Quiz/Browser promotion.

- Quiz Worker: `futureperfect-11plus-practice-step10-preview`
  - active timer-enhanced version: `118935bc-291e-4d0d-b046-219e0c894a6f`
  - immediate rollback version: `de5e171c-2ab8-4f6d-ac10-81d0f0dcc008`
  - Quiz D1: `5b988d3d-341a-492d-8e40-8d4efa66150e`
  - exact timer-enhanced `src/index.js` Git blob: `070081d24dd8d9c3f3add20d8d39f6c8f947bd86`
  - exact timer source commit: `dce500343f47786d1074b325948a562c424d3ea8`

- Production route remains `lessons.futureperfect.education/*` -> `fpt-portal-v2-rebuild-browser-prod`.
- Browser service binding remains `STAGING_API` -> `fpt-portal-v2-rebuild-student-prod`.

## Final Portal frontend acceptance

Exact accepted frontend source: `4a0a26090b1d119a7d6748d15eea3d7406513705`.

Off-production final frontend acceptance:
- run: `35355219788`
- conclusion: SUCCESS
- artifact: `10550854602`
- artifact digest: `sha256:19734ba89a81c3d32dcdcfdd842da013997bbec9fc3e3453f48dc7c59a3ff9ad`
- retained Portal tests plus Step 10 browser acceptance: **30/30 PASS** across desktop Chromium, mobile Chromium and iPad WebKit.

Final production Browser promotion:
- workflow run: `35361721026`
- job: `105654345467`
- conclusion: SUCCESS
- marker: `STEP10_FINAL_BROWSER_PRODUCTION_PASS`
- production bundle bytes/hash matched the exact rebuilt accepted candidate.
- rollback was armed and not required.

Verified production frontend contract:
- card label: `11+ Practice`
- card subtitle: `Take a real exam style GL quiz`
- superseded `Take a Maths quiz` copy absent.
- Portal uses `/api/v2/student/quiz/eligibility` and `/api/v2/student/quiz/launch`.
- retired `/api/v1/student/quiz/` endpoints absent from the production bundle.
- unauthenticated eligibility returns 401.
- unauthenticated launch returns 401.
- Student Worker remained unchanged.
- Quiz Worker remained on the timer-enhanced accepted version.

## Final Quiz engine acceptance

The standalone Quiz engine was previously accepted against the original Step 10 contracts, including selection hard gates, release/prerequisite enforcement, 30-day shared exact-question cooldown, unseen-first/breadth/adaptive behaviour, persisted served papers, result/remediation controls and timed-test enforcement.

Final engine acceptance evidence before the timer amendment:
- run: `35344538340`
- conclusion: SUCCESS
- artifact: `step10-final-engine-acceptance`
- artifact ID: `10545982612`
- artifact digest: `sha256:0248220424f73c51fb0c618a15ee34674a694d318957f1aefb72197b174c0ad2`

The final-minute rule was added off-production and verified before deployment:
- Timed Test remains server-authoritative at exactly 25:00.
- manual submission is rejected during the final 60 seconds.
- timeout auto-submission remains authoritative.

## Floating countdown timer amendment

Owner-approved final Timed Test timer behaviour:
- timed duration remains exactly **25 minutes**;
- countdown is fixed/floating so it remains visible while scrolling;
- normal appearance from 25:00 through 05:01 remaining;
- at exactly 05:00 remaining, the timer changes to amber;
- timer stays amber through 00:00;
- no red, flashing or pulsing warning state;
- untimed Stretch Test hides the timer;
- existing final-60-second manual-submit lock remains unchanged.

Off-production timer verification:
- workflow run: `35360573659`
- job: `105650532257`
- result: SUCCESS
- **26/26 Quiz tests PASS**
- marker: `STEP10_FLOATING_TIMER_OFFPRODUCTION_PASS`
- exact tested source commit: `dce500343f47786d1074b325948a562c424d3ea8`
- exact tested `src/index.js` blob: `070081d24dd8d9c3f3add20d8d39f6c8f947bd86`

Production timer promotion:
- workflow run: `35361387405`
- job: `105653219525`
- result: SUCCESS
- new production Quiz version: `118935bc-291e-4d0d-b046-219e0c894a6f`
- rollback version: `de5e171c-2ab8-4f6d-ac10-81d0f0dcc008`
- exact binding set and values preserved.
- Quiz health = 200.
- unauthenticated Quiz root = 303 back to Portal.
- invalid launch probe failed closed with the expected 410 response.
- Browser and Student Workers remained unchanged during Quiz promotion.
- automatic rollback was armed and not required.

## Cross-domain / Gate D authority retained

Gate D remains CLOSED — PASS. Its accepted real-browser and server-side evidence established the production Portal-to-Quiz launch bridge, one-time launch redemption, replay/expiry failure, Quiz-domain session isolation and zero test creation during the launch acceptance sequence.

The final promotion did not require another real-student acceptance session because:
1. the final Portal candidate was the exact source that passed the 30/30 browser matrix;
2. the cross-domain launch flow had already passed real-browser Gate D/Gate E acceptance;
3. the later Quiz changes were isolated to accepted timed-test behaviour and timer presentation;
4. exact production source/bundle identities were verified after promotion;
5. no backend eligibility/launch implementation was changed after the accepted Gate D Student Worker.

## Step 10 decision

All Step 10 rollout gates are satisfied. Step 10 is formally **CLOSED — PASS** in production.

Do not rerun production migrations, real-student launch acceptance or production deployments merely to reconfirm this state unless fresh evidence shows drift or a new change requires them.

## Next authorised phase

Immediately after this closeout, begin the separately documented post-Step-10 question-bank expansion programme.

Current expansion baseline:
- 714 FPT-owned production questions;
- 91 eligible families;
- 18 withheld families remain blocked;
- 1,150 Golden/source evidence questions remain evidence/benchmark material rather than the student-facing production bank.

Owner direction for expansion: actual GL Core questions are mandatory private benchmark/evidence examples for family expansion. New student-facing questions must remain FPT-original while matching genuine GL Core mathematical demand, structure, reasoning, presentation and distractor behaviour as closely as practicable.
