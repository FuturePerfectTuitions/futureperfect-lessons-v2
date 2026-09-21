# CP12 Quiz Browser — Post-Promotion Signed L2/L3 Acceptance

**Status: CLOSED — PASS**  
**Date:** 2026-09-21  
**Production host:** `lessons.futureperfect.education`

## Purpose

This supplement closes the one technical gap left after the CP12 Browser public-promotion closeout: the already-promoted live Browser state itself was exercised through signed production Portal → Bridge → Quiz launch/redeem flows for both L2 and L3 synthetic students.

The historical pre-promotion synthetic harness was preserved unchanged. A runtime copy was guardedly adapted only so its final public-surface assertion required the now-authorised promoted Quiz surface instead of the earlier withdrawal state.

## Authoritative result

- Workflow run: `35618996043`
- Workflow commit: `88028168854f24c4d383b64deb5408785ff6a667`
- Evidence artifact: `cp12-postpromotion-signed-e2e-evidence`
- Artifact ID: `10647313187`
- Artifact digest: `sha256:51aa0df64cca3485d306287e5c3a5098f2f8531a38ee12ce077a7a46c93fa0a4`
- Closeout marker: `CP12_POSTPROMOTION_SIGNED_E2E_CLOSED_PASS`

## Frozen production topology exercised

- Student Worker: `51d725cc-d21e-4aad-9c64-24149c640637`
- Browser Worker: `ea701c02-93f7-46e9-9182-59a785dc0bee`
- Bridge Worker: `2ae28100-b4c6-40a3-87e2-42aef86c6fdf`
- Quiz Worker: `80d4942e-616c-4539-91f1-9f2daf05cfc1`
- Live Browser bundle SHA-256: `ee665945ab14c80d2747d603138db8f0b4e2afef84656de04d0025409c2ef0c9`

The Browser and Bridge versions above are exactly the versions recorded by the CP12 public-promotion closeout.

## Signed L2/L3 acceptance

The guarded production test created fresh synthetic identities only, using pre-existing assignment-ID gaps so the production AUTOINCREMENT sequence could not be advanced.

Both personas passed:

- L2: signed Portal login, two released canonical L2 lessons, server-authorised Quiz launch, one-time Bridge redemption, Quiz identity continuity.
- L3: signed Portal login, two released canonical L3 lessons, server-authorised Quiz launch, one-time Bridge redemption, Quiz identity continuity.

Evidence markers:

- `CP12_L2_SIGNED_LAUNCH_REDEEM_PASS`
- `CP12_L3_SIGNED_LAUNCH_REDEEM_PASS`
- `CP12_SYNTHETIC_E2E_FINAL_PASS`

No synthetic practice test, exposure history, or attempt history was created.

## Cleanup proof

Cleanup restored the synthetic fixture state to the exact pre-test baselines:

- Portal synthetic rows: zero remaining;
- Quiz synthetic rows: zero remaining;
- Students KV synthetic keys: absent;
- prepared access-model synthetic pointer/version keys: absent;
- `quiz_launch_codes`: returned to baseline `8` rows;
- `student_batch_assignments` AUTOINCREMENT sequence: remained `181`.

Final cleanup marker:

`CP12_E2E_CLEANUP_PASS launchRows=8 assignmentSequence=181 portalSurfacePromoted=true`

## Independent live Browser/security check

After signed E2E and cleanup, the workflow independently fetched the real public Portal again and verified:

- live bundle SHA-256 remained `ee665945ab14c80d2747d603138db8f0b4e2afef84656de04d0025409c2ef0c9`;
- the promoted bundle contains the Quiz eligibility route, launch route, `11+ Practice` surface marker and Quiz host;
- unauthenticated eligibility returned `401`;
- unauthenticated launch returned `401`;
- hostile-origin launch returned `403`.

## Closure

The CP12 Quiz Browser public promotion is now supported by both:

1. the propagation-aware public promotion closeout; and
2. this post-promotion signed L2/L3 production acceptance.

**Post-promotion signed acceptance: CLOSED — PASS.**
