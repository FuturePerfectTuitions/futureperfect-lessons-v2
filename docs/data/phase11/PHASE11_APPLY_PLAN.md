# Phase 11 — guarded catalogue apply plan

Status: **IMPLEMENTATION READY FOR CI**

The Phase 11 apply is split into two repository changes so the real catalogue cannot be written merely by merging implementation code.

1. The implementation PR adds the locked 369-lesson catalogue payload, validators, Phase 11 proof page, owner-requested test personas, acceptance suites and the guarded Cloudflare apply workflow. It leaves the checked-in normal Worker entrypoint on Phase 10 and performs no Cloudflare write.
2. After the implementation PR passes CI and is merged, a separate trigger-only PR from `ops/phase11-catalogue-apply` may change only `.github/phase11-apply-trigger.txt`. The base-branch workflow then performs the guarded V2 development apply.

Before any write the workflow verifies the isolated V2 bindings, confirms normal student login is disabled, checks the expected development allowlist state, validates the locked catalogue hashes, snapshots every Phase 11 LESSONS_KV write target, snapshots the nine test-user keys, snapshots all six Phase 10 special catalogue keys, backs up relevant D1 test/history rows, and uploads the pre-write evidence as a GitHub Actions artifact.

The actual apply deploys the backwards-compatible `index-phase11-final.js` Worker to the V2 development Worker, bulk-writes exactly 380 canonical lesson/curriculum KV records, seeds exactly nine owner-requested development test accounts, seeds their deterministic D1 entitlements, re-anchors `test0707` history to real canonical lessons, exact-verifies the remote KV values, confirms the six special catalogue records are unchanged, and runs deployed API plus real-Chrome acceptance.

No R2 mutation is performed by this apply. The previously verified 1,669-object development R2 corpus is read only. No KV delete operation is present. The existing live portal is not targeted.
