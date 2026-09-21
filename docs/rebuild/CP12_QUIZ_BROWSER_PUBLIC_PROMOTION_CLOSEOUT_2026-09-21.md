# CP12 Quiz Browser Public Promotion — Closeout

**Status: CLOSED — PASS**  
**Date:** 2026-09-21  
**Production host:** `lessons.futureperfect.education`

## Authoritative promotion result

The CP12 Quiz Portal surface was promoted through the existing production Browser Worker only. The final propagation-aware promotion workflow completed successfully with no rollback.

- GitHub Actions run: `35616396909`
- Workflow commit: `3064ae531147bbf07f91353b3463e20bd509a385`
- Evidence artifact: `cp12-browser-propagation-aware-promotion-evidence`
- Artifact ID: `10646443326`
- Artifact digest: `sha256:9335650be6b63186880247662e26d298a5ff29821b1201384c8e348c0222e279`
- Closeout marker: `CP12_BROWSER_PUBLIC_PROMOTION_PASS`

## Frontend provenance

- Frontend repository: `FuturePerfectTuitions/futureperfect-lessons-test`
- Accepted frontend commit: `63f37895727e41ada427c9644b41b5a026ed196b`
- Browser candidate/version promoted: `ea701c02-93f7-46e9-9182-59a785dc0bee`
- Production bundle SHA-256: `ee665945ab14c80d2747d603138db8f0b4e2afef84656de04d0025409c2ef0c9`

The fresh local build, version-preview bundle, zero-percent version-override bundle, public production bundle, and delayed stability-recheck bundle all matched that exact SHA-256.

## Final production topology

At closeout:

- Student Worker `fpt-portal-v2-rebuild-student-prod`: `51d725cc-d21e-4aad-9c64-24149c640637` at 100%.
- Browser Worker `fpt-portal-v2-rebuild-browser-prod`: `ea701c02-93f7-46e9-9182-59a785dc0bee` at 100%.
- Bridge Worker `fpt-portal-v2-worker`: `2ae28100-b4c6-40a3-87e2-42aef86c6fdf` at 100%.
- Quiz Worker `futureperfect-11plus-practice-step10-preview`: `80d4942e-616c-4539-91f1-9f2daf05cfc1` at 100%.
- Public route remains `lessons.futureperfect.education/*` → `fpt-portal-v2-rebuild-browser-prod`.
- Browser bindings remain exactly `ASSETS` plus `STAGING_API` → `fpt-portal-v2-rebuild-student-prod`.
- Portal D1 `quiz_launch_codes` row count remained `8`.

The Bridge version above is the independently verified PreLesson VR production fix. It was intentionally preserved rather than reverted. Its successful production workflow retained CP12 bridge/redeem behaviour and reconciled current student read models without mutating canonical sources.

## Promotion gates passed

The successful run proved, in order:

1. fresh immutable production anchors, Browser route/bindings and launch-row baseline;
2. exact rebuild of the accepted frontend commit;
3. candidate byte identity and fail-closed API facade;
4. old Browser at 100% plus candidate at 0% verified through the Cloudflare deployment state;
5. exact candidate smoke through the production hostname using a version override;
6. candidate promotion to 100% verified through the Cloudflare deployment state;
7. bounded public-edge propagation until the production hostname served the exact candidate bundle;
8. public security behaviour: unauthenticated eligibility `401`, unauthenticated launch `401`, hostile-origin launch `403`;
9. delayed stability recheck serving the same exact candidate bundle; and
10. unchanged non-Browser production anchors and unchanged launch-code baseline.

The emergency rollback step was skipped because all gates passed.

## Hidden signed end-to-end acceptance retained

Before Browser promotion, the production-shaped hidden CP12 E2E had already passed for both L2 and L3:

- signed Portal login;
- exact release-context generation;
- one-time launch creation;
- Bridge redemption;
- Quiz `/api/me` identity continuity;
- no practice-test or question-history creation from the synthetic acceptance run; and
- complete cleanup back to the pre-test Portal baseline.

## Rollback anchor

The pre-CP12 Browser rollback version remains:

`f8a64bc8-8192-4400-9e45-8f1a1de10019`

Rollback is Browser-only. It must not overwrite or revert independently verified Student, Bridge or Quiz production changes.

## Closure decision

CP12 Quiz Browser public promotion is **CLOSED — PASS**. The production Portal now carries the server-authorised Quiz surface from frontend commit `63f37895727e41ada427c9644b41b5a026ed196b`, with eligibility and launch authority remaining server-side and fail-closed.