# Portal V2 Performance Rebuild — Checkpoint 3

## Admin/Operations Compiler and Atomic Publishing

Baseline production backend source: `e4c7bde7ad9a9402136da5798d7ab690ab30322c`.

Checkpoint 3 moves expensive preparation work to the isolated Admin/Operations side. It does not cut student traffic over to the rebuild and it does not begin Checkpoint 4 dual-write compatibility.

## Scope

The Checkpoint 3 Operations compiler owns the preparation boundary for:

- authoritative catalogue construction from already-read source records;
- compact navigation and per-view catalogue/count generation;
- deterministic entitlement/access-snapshot resolution from already-read access inputs;
- resource-existence validation before a lesson-detail read model can be considered publishable;
- immutable version publication and a small current-version pointer.

The existing Checkpoint 2 read-model functions remain the semantic source for catalogue and access compilation. Checkpoint 3 wraps those pure functions on the Operations side and adds validation/publication mechanics.

## Atomic publication protocol

Cloudflare KV is not treated as a multi-key transaction store. The publisher therefore uses immutable values plus a tiny pointer for each logical scope.

For a scope such as `global`:

1. Compile the complete payload in memory.
2. Canonically serialise it and calculate its SHA-256.
3. Write one immutable candidate envelope under a versioned key.
4. Read the candidate back and verify schema, scope and digest.
5. Only after verification, write the small `current` pointer.
6. The pointer records both the new current version and the previous complete version.
7. Readers verify the candidate digest. If a newly written current candidate has not propagated to an edge yet, they may use the pointer's previous complete version instead.
8. If neither current nor previous verifies, the resolver fails closed.

A compile or validation failure occurs before the pointer write. A deliberately injected failure after candidate verification but before the pointer write leaves the previous complete pointer untouched. The orphan candidate is unreachable and therefore harmless.

## Staging namespace

Checkpoint 3 uses a dedicated additive staging-only KV namespace named:

`FPT_PORTAL_V2_REBUILD_READ_MODELS_STAGING`

The namespace is created or reused by the guarded GitHub Actions workflow. It is not a production `STUDENTS_KV` or `LESSONS_KV` namespace and is not bound to the production Worker.

Production `LESSONS_KV` remains a read-only source for compiling the current global catalogue. The final Admin/Operations staging Worker is deployed with only the dedicated `READ_MODELS_KV` binding plus plain non-secret environment markers.

## Resource existence validation

`compileLessonDetail()` requires an explicit asynchronous `resourceExists(objectKey)` validator for every R2-backed lesson resource it includes. Any missing object causes compilation to fail before publication.

Checkpoint 3 proves this mechanism with deterministic synthetic resource tests. It does **not** claim that every live production R2 object has been bulk-validated in this checkpoint, and the Admin/Operations staging Worker is not given the production R2 binding. Bulk production-shaped resource reconciliation belongs to the later backfill/UAT gates.

## Student-data boundary

Checkpoint 3 does not read real `STUDENTS_KV` records, copy pupil access snapshots into staging, or expose a student mutation route. The access compiler is exercised with synthetic inputs only at this checkpoint.

## Acceptance gate

Checkpoint 3 passes only when all of the following are evidenced:

- Operations-side catalogue/access compiler regression tests pass;
- resource-existence success and missing-resource failure paths pass;
- an initial complete global model publishes to the isolated staging read-model KV;
- a deliberate failure after immutable candidate creation leaves the current pointer byte-for-byte unchanged;
- a resolver test proves previous-version fallback during simulated propagation skew;
- Admin/Operations staging resolves the published current global model through its `READ_MODELS_KV` binding;
- the staging Worker has no production `STUDENTS_KV`, production `LESSONS_KV`, D1, R2 or email binding;
- production Worker deployment and version remain exactly the Checkpoint 0 anchor before and after the staging work.

## Explicit non-goals

Checkpoint 3 does not start dual-write compatibility, replace production authentication, issue capabilities, redesign the Student Worker, rebuild the frontend, backfill real student access snapshots, repoint production routes, or repair the parked current-production Admin Answer Pack defect.
