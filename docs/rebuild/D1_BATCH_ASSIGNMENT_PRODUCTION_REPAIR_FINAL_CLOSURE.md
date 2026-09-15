# D1 Batch Assignment Production Repair — Final Closure Record

**Status: CLOSED — PASS**

Date: 2026-09-15  
Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`  
Clean post-CP13 baseline: `4559416ca66c39b2523a2f41405533f2857356b8`  
Read-only audit closure: `09149b47afdda15541977cfa3c68b7ee20632564`  
Repair branch: `repair/d1-batch-assignment-reconciliation-2026-09-15`

## Scope

The owner authorized a production repair after the independent read-only reconciliation proved that the authoritative live roster contained 25 current memberships while production D1 contained only four `student_batch_assignments` rows. The four existing rows were exact matches and the remaining 21 were classified `SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER`, with zero date/window mismatches, zero extra assignments and zero unproven cases.

The repair scope was strictly limited to the 21 missing assignment rows. No lesson entitlement, profile, lesson resource, Worker, route, binding, deployment or frontend mutation was in scope.

## Attempt 1 — safe no-op failure

The first guarded workflow run was `34998457021`. It failed because Cloudflare D1 rejected the single 21-row INSERT statement for exceeding the SQL-variable limit. The failure occurred before any row was inserted. Automatic rollback verification reported zero rows to delete, leaving the original four-row audited state intact.

Evidence artifact: `10409145233`  
Digest: `sha256:3d6d20e84af0f9c304008489faf387f2c9165a8a7721da4679a32e8efa765557`

## Successful production repair

The corrected V2 workflow used a fresh read-only preflight immediately before mutation, then inserted the 21 approved rows using variable-safe individual INSERT statements. No UPDATE operation was performed. DELETE capability was limited to exact automatic rollback of rows stamped by that same repair run if any postcondition failed; rollback was not required.

Successful workflow run: `34998758732`  
Successful run head: `33837a79d918022f80898934e22056e56f9caa6c`  
Evidence artifact: `10409125502`  
Digest: `sha256:34ac864149f8737892bec61b17bf52b39c3d34cb6ad442282956768b6e242378`

Verified V2 repair result:

- before assignment rows: 4;
- inserted rows: 21;
- final assignment rows: 25;
- authoritative exact matches after repair: 25;
- missing assignments after repair: 0;
- date/window mismatches after repair: 0;
- extra current assignments after repair: 0;
- extra historical assignments after repair: 0;
- rebuilt Student direct `student_batch_assignments` references: 0;
- independent roster-backed entitlement audit: PASS;
- independent semantic entitlement audit: PASS;
- current semantic under-entitlement rows: 0.

An exact rollback SQL statement was retained in the successful evidence artifact. It can remove only assignment IDs `161` through `181` created at `2026-09-15T17:02:51.949Z` by this repair run. It must not be used unless an explicit rollback decision is made.

## Production topology and version invariants

The successful repair verified identical before/after production topology and active versions:

- public route: `lessons.futureperfect.education/*`;
- route script: `fpt-portal-v2-rebuild-browser-prod`;
- Browser service binding: `STAGING_API -> fpt-portal-v2-rebuild-student-prod`;
- Browser active version: `67880177-1328-46dd-a228-47ba245e33ae`;
- Student active version: `32467053-f348-449c-a2ae-1dae9688b446`;
- retained legacy Worker active version: `2eec1f4d-daec-4d40-be55-b779852ddfb2`;
- no Browser -> Admin/AdminOps binding.

No Worker deployment was performed by this data repair.

## Independent final read-only observer

The first post-repair independent observer run `34998947101` completed SUCCESS and produced artifact `10409185985`, digest `sha256:5f307e99b2af2afd87109e51f89fb1a3880ef807033d47a113887d981c2cbe87`.

Its independent result was:

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

This closure commit intentionally re-triggers the same read-only observer so the final branch HEAD itself is independently observed. Closure is accepted only if that exact-head observer completes SUCCESS without any mutation.

## Closure declaration

The 21-row D1 batch-assignment data-integrity repair is complete. Production D1 now exactly represents all 25 authoritative current roster memberships. No entitlement/resource semantics were broadened by the repair, no runtime source or deployment changed, and rollback evidence is retained.

**D1 BATCH ASSIGNMENT PRODUCTION REPAIR — CLOSED — PASS**
