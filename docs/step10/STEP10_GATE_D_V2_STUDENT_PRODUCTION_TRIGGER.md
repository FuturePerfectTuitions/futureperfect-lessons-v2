# Step 10 Gate D — API-v2 Student Worker production trigger

Date: 2026-09-18
Gate: D only — authorised / in progress
Gate E: not authorised

Purpose: trigger the guarded Student-Worker-only production deployment of the API-v2 quiz eligibility and launch boundary after validation run 35325399075 passed.

Hard boundaries:
- Deploy only `fpt-portal-v2-rebuild-student-prod`.
- Preserve the Browser Worker route and service binding exactly.
- Preserve all live Student Worker bindings and secret names exactly.
- Require Portal D1 ID `97250a54-fa91-45ad-a002-3c4566b1fc38`.
- Do not deploy any frontend/browser UI.
- Do not deploy or merge legacy PR #11.
- Do not fabricate Portal sessions or launch rows.
- Automatic rollback on any post-deployment gate failure.

Validated source branch: `mastery/step10-gate-d-v2-backend-2026-09-18`.
