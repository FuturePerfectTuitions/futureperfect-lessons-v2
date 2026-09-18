# Step 10 Gate E — Production Frontend Rollback

Date: 2026-09-18
Status: **ROLLED BACK — CONTINUE OFF-PRODUCTION**

## Owner direction
The owner requested that the Gate E production frontend be rolled back so real students, including the authorised acceptance account, do not see the 11+ Practice card while remaining Step 10 work is completed. Final production deployment is deferred until the complete Step 10 package is ready.

## Rollback evidence
GitHub Actions run `35343260024` (`Step 10 Gate E production frontend rollback`) completed **SUCCESS**.

Precheck observed the live Gate E frontend:
- Browser Worker: `d59497dd-c2cc-48d6-b733-5169270059de`
- Student Worker: `f26167b1-073c-4015-912a-288a3d20e0bb`
- Quiz Worker: `13eda650-d6b3-4ed3-a3cc-c788306a4789`
- Gate E bundle: `assets/portal-wK1OwW5J.js`
- Gate E bundle SHA-256: `3907cb7782d070590c2f2c00bebb09fe80260de295e35b3dd1a41a8309e2cb5e`

The Browser Worker was then rolled back to the exact pre-Gate-E production version:
- Browser Worker: `f8a64bc8-8192-4400-9e45-8f1a1de10019`
- restored bundle: `assets/portal-CeIaLZ5y.js`
- restored SHA-256: `9dc3203a012c1530216cba9f8362d227a46745249499362a3160310bb34f45dc`

Final verification marker: `STEP10_GATE_E_ROLLBACK_PASS`.

Final verification also proved:
- `gateECardExposed: false`
- `gateDBackendPreserved: true`
- Student Worker remained `f26167b1-073c-4015-912a-288a3d20e0bb`
- Quiz Worker remained `13eda650-d6b3-4ed3-a3cc-c788306a4789`
- unauthenticated Gate D eligibility endpoint still fails closed with HTTP 401
- no bound D1/R2/KV resources were rolled back or mutated by the Browser Worker version rollback.

## Current boundary
- Gates A–D: retain their prior CLOSED/PASS evidence.
- Gate E implementation and prior real-UI acceptance evidence are retained as test evidence, but Gate E is **not currently live in production**.
- Continue all remaining Step 10 verification and remediation off-production.
- Do not expose the Gate E card to students again until final readiness has been established and a deliberate final production promotion is made.
