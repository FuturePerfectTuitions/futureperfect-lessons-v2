# CP12 Quiz Browser — Rendered Visual Acceptance

**Status: CLOSED — PASS**  
**Date:** 2026-09-21  
**Production host:** `lessons.futureperfect.education`

## Purpose

This record closes the remaining visual-rendering gap after CP12 Browser promotion. It uses fresh synthetic L2 and L3 production identities only, not real pupil credentials, and verifies the actual live Portal in Chromium.

## Authoritative run

- GitHub Actions run: `35619476013`
- Workflow commit: `83c6a0ab151686fe20056bd02bfaa6a35d4ea2a7`
- Evidence artifact: `cp12-postpromotion-rendered-browser-evidence`
- Artifact ID: `10647468952`
- Artifact digest: `sha256:56b5adca81bb428a7f83ed7651eeb7f7d2deb41f56cf670911168c4ca6552db6`
- Closeout marker: `CP12_POSTPROMOTION_RENDERED_BROWSER_CLOSED_PASS`

## Production versions exercised

- Student Worker: `51d725cc-d21e-4aad-9c64-24149c640637`
- Browser Worker: `ea701c02-93f7-46e9-9182-59a785dc0bee`
- Bridge Worker: `2ae28100-b4c6-40a3-87e2-42aef86c6fdf`
- Quiz Worker: `80d4942e-616c-4539-91f1-9f2daf05cfc1`
- Browser bundle SHA-256: `ee665945ab14c80d2747d603138db8f0b4e2afef84656de04d0025409c2ef0c9`

## Rendered browser proof

The workflow used Playwright `1.55.0` with headless Chromium and, for each synthetic persona, performed the real browser journey:

1. wait for production credential/read-model propagation;
2. open `lessons.futureperfect.education`;
3. enter the synthetic username/password through the rendered login form;
4. wait for the signed-in subject screen;
5. open **Maths**;
6. wait for the server-authorised practice-card eligibility request to complete;
7. require exactly one visible `[data-quiz-practice="true"]` card;
8. verify the title is exactly `11+ Practice`;
9. verify the displayed copy is exactly `Take a real exam style GL quiz`;
10. verify the card has a non-zero rendered bounding box; and
11. capture a full-page screenshot.

Both personas passed:

- L2 rendered card: `506 × 112` CSS pixels.
- L3 rendered card: `506 × 112` CSS pixels.

Evidence markers:

- `CP12_L2_RENDERED_PRACTICE_CARD_PASS`
- `CP12_L3_RENDERED_PRACTICE_CARD_PASS`

The retained screenshots show the practice card alongside the student's current L2/L3 Maths level on the live Portal.

## Signed launch/redeem and cleanup

After the visual proof, the same synthetic personas also passed the signed Portal → Bridge → Quiz launch/redeem acceptance:

- `CP12_L2_SIGNED_LAUNCH_REDEEM_PASS`
- `CP12_L3_SIGNED_LAUNCH_REDEEM_PASS`

Cleanup then restored all synthetic state to its pre-test baselines:

- `quiz_launch_codes`: `8` rows;
- `student_batch_assignments` AUTOINCREMENT sequence: `181`;
- synthetic Portal rows: zero remaining;
- synthetic Quiz rows: zero remaining;
- synthetic Students KV/access-model keys: absent.

Cleanup marker:

`CP12_E2E_CLEANUP_PASS launchRows=8 assignmentSequence=181 portalSurfacePromoted=true`

## Independent post-test verification

After browser rendering, signed launch/redeem, and cleanup, the workflow independently re-fetched production and verified:

- exact Browser bundle SHA-256 unchanged;
- unauthenticated eligibility = `401`;
- unauthenticated launch = `401`;
- hostile-origin launch = `403`.

## Closure

The live production Quiz card is now proven at three layers:

1. exact public bundle promotion and propagation;
2. signed L2/L3 server-side launch/redeem acceptance; and
3. actual rendered L2/L3 browser visibility in the production Portal.

**Rendered visual acceptance: CLOSED — PASS.**
