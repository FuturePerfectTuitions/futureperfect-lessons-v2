# CP12 Resource UI Production Promotion Trigger V2

Checkpoint: Official CP12 — Stabilisation Period only.

Purpose: trigger the guarded production promotion for the already staging-proven collapsible resource hierarchy and canonical `presentationGroup` metadata integration.

Required invariants:
- Preserve `lessons.futureperfect.education` → Browser → Student service binding topology.
- Do not introduce Browser→AdminOps routing, wrappers, overlays, request-time entitlement reconstruction, or new Student hot-path storage calls.
- Preserve current Student/Browser bindings, secrets and rollback versions.
- Publish only metadata-only prepared lesson changes proven by the CP12 read-only preflight.
- Promote Student and Browser candidates through zero-percent smoke gates before 100% traffic.
- Automatically restore Browser, Student and prepared pointers on any post-metadata failure.
- Keep legacy Operations Worker unchanged during this UI promotion.

Validated evidence before trigger:
- production preflight run `34880780031` — SUCCESS;
- promotion-v2 validation run `34881635913` — SUCCESS;
- published lesson scopes `372`; metadata-only changes `369`; unchanged `3`;
- prepared resources `1509`: core `984`, 11+ `212`, VR `313`;
- non-presentation metadata differences `0`.

Do not start CP13.
