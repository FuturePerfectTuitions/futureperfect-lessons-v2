# PreLesson VR production fix closeout — 2026-09-21

## Status

CLOSED — PASS.

## Fault corrected

Two linked defects were corrected for online Year 4/5 11+ English PreLesson access:

1. `online_prelesson_entitlements.vr_access=1` was being loaded from canonical D1 but discarded when the prepared student access snapshot was compiled. The compiler now carries that flag into `lessonAccess[lessonId].vr` and asserts canonical-to-read-model parity.
2. The online lesson-release importer incorrectly required the legacy student-profile `vrEligible` flag as well as 11+ English batch membership. The importer now derives lesson-specific VR PreLesson eligibility from the authoritative Year 4/5 11+ English batch semantics.

Source fix commit: `d8931355564fdcfd160c946f3d7a6fe83a633244` (`Fix 11+ online PreLesson VR projection`).

## Production safety boundary

The live Admin Worker had already advanced beyond `main` for CP12. The fix was therefore based on the exact successful CP12 source commit `dcb334114f48fcec3ec3f5a22a5d2b062efe8083` rather than redeploying stale `main`.

The pre-mutation rollback anchor was live Worker version `2631c603-89eb-495c-b0e4-c2d87272a5b2`.

Focused PreLesson tests and the existing CP12, protected-view, Admin, parent-email, Phase 12 and Phase 13 regression gates all passed before deployment.

## Fresh canonical-state check

Immediately before mutation, production D1 showed the existing Year 4/5 11+ English online PreLesson rows already had `vr_access=1`. The guard found **0** Year 4/5 11+ English online PreLesson rows incorrectly stored with `vr_access=0`, so no D1 backfill was required.

The public Student Portal Quiz surface was verified withdrawn before and after deployment, and the CP12 bridge markers and bindings were preserved.

## Production deployment

GitHub Actions run: `35596253078` — `PreLesson VR CP12-safe production fix` — PASS.

New production Admin Worker version: `2ae28100-b4c6-40a3-87e2-42aef86c6fdf` at 100%.

Deployment message: `Fix 11+ online PreLesson VR projection`.

Production bindings remained unchanged, including canonical D1, STUDENTS_KV, LESSONS_KV, READ_MODELS_KV and the CP12 Quiz bridge secret.

## Existing-student repair

After deployment, every current student prepared access snapshot was reconciled using the corrected compiler:

- eligible current students: **25**
- reconciled: **25**
- published: **25**
- failures: **0**
- canonical sources mutated: **false**
- write target: **READ_MODELS_KV only**
- atomic per-student pointers: **true**
- student identities included in evidence: **false**
- credentials disclosed: **false**

The reconciliation now includes a hard parity assertion: any canonical online PreLesson row with `vr_access=1` must compile to a prepared lesson access state with `vr=true`, otherwise reconciliation fails closed.

## Result

Existing authorised online Year 4/5 11+ English students now receive their lesson-specific VR PreLesson resources in the prepared Portal access model, and future online imports use the same authoritative 11+ English batch rule without depending on the legacy `vrEligible` profile flag.
