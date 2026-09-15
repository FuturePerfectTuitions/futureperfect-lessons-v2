# D1 Batch Assignment Production Repair — Final Closure Record

**Status: CLOSED — PASS**

Date: 2026-09-15  
Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`  
Clean post-CP13 code baseline before this record: `4559416ca66c39b2523a2f41405533f2857356b8`  
Read-only audit closure: `09149b47afdda15541977cfa3c68b7ee20632564`  
Repair evidence branch: `repair/d1-batch-assignment-reconciliation-2026-09-15`

## Scope

The owner authorized a production data repair after an independent read-only reconciliation proved that the authoritative live roster contained 25 current memberships while production D1 contained only four `student_batch_assignments` rows. The four existing rows were exact matches and the remaining 21 were classified `SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER`, with zero date/window mismatches, zero extra assignments and zero unproven cases.

The repair scope was strictly limited to those 21 missing assignment rows. No lesson entitlement, student profile, lesson resource, Worker, route, binding, deployment or frontend mutation was in scope.

## Attempt 1 — safe no-op failure

The first guarded workflow run was `34998457021`. Cloudflare D1 rejected the single 21-row INSERT statement because it exceeded the SQL-variable limit. The failure happened before any row was inserted; rollback verification found zero inserted rows and production remained in the original four-row audited state.

Evidence artifact: `10409145233`  
Digest: `sha256:3d6d20e84af0f9c304008489faf387f2c9165a8a7721da4679a32e8efa765557`

## Successful production repair

The corrected V2 workflow used a fresh read-only preflight immediately before mutation and inserted the 21 approved rows using variable-safe individual INSERT statements. No UPDATE operation was performed. DELETE capability was limited to automatic rollback of exact rows stamped by that repair if a postcondition failed; rollback was not required.

Successful workflow run: `34998758732`  
Successful run head: `33837a79d918022f80898934e22056e56f9caa6c`  
Evidence artifact: `10409125502`  
Digest: `sha256:34ac864149f8737892bec61b17bf52b39c3d34cb6ad442282956768b6e242378`

Verified result:

- before assignment rows: 4;
- inserted rows: 21;
- final assignment rows: 25;
- authoritative exact matches after repair: 25;
- missing assignments: 0;
- date/window mismatches: 0;
- extra current assignments: 0;
- extra historical assignments: 0;
- rebuilt Student direct `student_batch_assignments` references: 0;
- roster-backed entitlement audit: PASS;
- semantic entitlement audit: PASS;
- current semantic under-entitlement rows: 0.

The successful evidence artifact retains an exact rollback statement limited to assignment IDs `161` through `181`, created at `2026-09-15T17:02:51.949Z` by this repair. It must not be used without an explicit rollback decision.

## Production invariants

The repair verified unchanged production topology and active versions:

- public route: `lessons.futureperfect.education/*`;
- route script: `fpt-portal-v2-rebuild-browser-prod`;
- Browser service binding: `STAGING_API -> fpt-portal-v2-rebuild-student-prod`;
- Browser active version: `67880177-1328-46dd-a228-47ba245e33ae`;
- Student active version: `32467053-f348-449c-a2ae-1dae9688b446`;
- retained legacy Worker active version: `2eec1f4d-daec-4d40-be55-b779852ddfb2`;
- no Browser -> Admin/AdminOps binding.

No Worker deployment occurred as part of this data repair.

## Independent final observer

The final exact-head read-only observer ran as workflow `34999254106` against repair-branch HEAD `9143cbae62919ffff004bb2a8f4141fb6ec6eaa2` and completed SUCCESS.

Final observer artifact: `10408782986`  
Digest: `sha256:f5d900a627543ae1a0dca5823bd22cd1924728ec7763410bd8724110d30c33fa`

It independently confirmed:

- D1 roster memberships: 25;
- exact matches: 25;
- missing assignments: 0;
- date/window mismatches: 0;
- extra assignments: 0;
- roster-backed entitlement status: PASS;
- semantic entitlement status: PASS;
- current semantic under-entitlement rows: 0;
- rebuilt Student assignment-table references: 0;
- public Browser -> Student topology unchanged;
- Browser, Student and retained legacy active versions unchanged.

## Repository close-out

The repair workflows, repair scripts and trigger files remain isolated on the repair evidence branch and are intentionally **not** merged into the clean post-CP13 baseline. This clean branch carries only the durable production-source fixes already accepted plus this historical closure record.

**D1 BATCH ASSIGNMENT PRODUCTION REPAIR — CLOSED — PASS**
