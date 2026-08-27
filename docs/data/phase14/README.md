# Phase 14 — deliberate Excel failure/retry/correction matrix

Status: **IN PROGRESS**. Phase 13 remains formally CLOSED/PASS. Phase 15 must not start until Phase 14 is explicitly closed.

## Starting evidence boundary

Phase 14 starts from Phase 13 closure main SHA `458a67cee0f20b21a6083e7073190cfe14628867` (PR #122 merged). The first Phase 14 preflight reconnected to GitHub before implementation work and confirmed that main was still exactly that SHA. All pre-existing open PRs were stale Phase 11 operational/diagnostic work; no earlier Phase 14 implementation branch existed.

A fresh read-only Cloudflare audit was also run before Phase 14 implementation changes. It confirmed the deployed Worker is the Phase 13 development Worker, `ENVIRONMENT=development`, normal student login disabled, development R2 `fpt-materials-dev`, the expected V2 KV/D1 bindings, the dedicated Excel sync secret present by name only, and no legacy `FPT_LESSONS_TEST` binding. The audit performed no deploy or Cloudflare write.

## Credit / gap matrix

Phase 13 acceptance is authoritative evidence. Already-passed mutation tests are credited rather than recreated merely to reproduce a green result.

| Original matrix behaviour | Phase 14 disposition | Evidence / remaining work |
| --- | --- | --- |
| First selected Completed release | CREDIT | Phase 13 copied-workbook Worker → D1 grant passed. |
| Same row again / read-only status check | CREDIT | Phase 13 repeat/idempotency passed. |
| Duplicate Student + Lesson | CREDIT + regression | Phase 13 copied-row proof retained one permanent entitlement; Phase 14 may re-check non-destructively. |
| Copied rows / duplicate Sync Row IDs | CREDIT | Phase 13 R3 copied-ID repair passed. |
| Changed Student/Lesson fingerprints | CREDIT | Phase 13 proved new current context without revoking old permanent entitlement. |
| Invalid/nonexistent Lesson ID | CREDIT | Phase 13 mixed valid + invalid request passed independently. |
| Effective-dated assignment reject/retry | CREDIT | Phase 13 rejection and successful retry after restoration passed. |
| Moved lesson date | CREDIT | Phase 13 updated Batch + Lesson context without duplicating Student + Lesson. |
| Late-added second lesson | CREDIT | Phase 13 passed. |
| Manual block / unblock | CREDIT | Phase 13 passed; final owner R3 uses bold red / bold green font with no status fill. |
| Worker/API unavailable or transport failure | **MISSING** | Must be proved end-to-end in the owner’s current copied R3 workbook: queued rows must lose any stale confirmed styling, remain retryable and produce no unintended D1 mutation. |
| Full Library overlap | **MISSING → Phase 14 test** | An unsynced Excel row must remain unconfirmed even if manual Full Library already opens the lesson; an explicit successful sync must create/confirm an independent direct Student + Lesson entitlement. |
| Ordinary Maths outcome | **MISSING → Phase 14 test** | Prove ordinary Maths creates core access only and preserves all release guards. |
| Ordinary English outcome | **MISSING → Phase 14 test** | Prove normal English creates core access only, not VR. |
| English 11+ + VR outcome | **MISSING → Phase 14 test** | Prove a VR-eligible student in an exact active English 11+ batch receives core + VR on a first valid release. |
| One bad item does not block valid items | CREDIT + regression | Phase 13 mixed-result proof passed; Phase 14 static/live regression will re-check without repeating old fixtures. |
| Failed/skipped case never confirmed green | CREDIT + workbook transport gap | Phase 13 failure/skip cases passed; the transport-failure desktop path remains mandatory because it is the remaining unproved stale-status scenario. |

## Phase 14 controlled fixture plan

Only temporary, clearly named TestY development fixtures may be used. Before any temporary D1/KV write, the acceptance workflow must prove:

- documented D1 closure baseline is exactly 632 `lesson_entitlements`, 4 `batch_definitions`, 4 `student_batch_assignments`, 0 `batch_lesson_releases`;
- exactly two assigned development users retain 173 entitlement rows;
- D1 `PRAGMA quick_check` is `ok` and `trg_student_sessions_single_active` exists;
- every exact Phase 14 temporary user/batch/assignment/release/entitlement key is absent;
- Worker remains development-only, normal login disabled, R2 is `fpt-materials-dev`, and legacy `FPT_LESSONS_TEST` is not the Worker lesson binding;
- the selected canonical test lessons are live/active with the expected subject and canonical curriculum metadata.

After testing, cleanup must remove only the exact Phase 14 rows/keys proved absent at preflight and restore the same documented baseline. Cleanup must run on failure as well as success.

## Phase 14 static matrix added

`tests/phase14-excel-sync-matrix-verification.mjs` covers the still-missing API semantics without touching Cloudflare:

- Full Library alone does not make the Excel `status_check` confirmed;
- ordinary Maths creates core only;
- ordinary English creates core only;
- first English 11+ release for a VR-eligible student creates core + VR;
- Full Library overlap still creates the independent direct Excel entitlement;
- one invalid item does not block four valid items in the same request;
- a deliberate per-item runtime/store exception returns retryable `ERROR` without blocking a valid item;
- duplicate Student + Lesson remains idempotent;
- no entitlement deletion or batch-membership mutation path is introduced.

## Workbook boundary

The final owner R3 workbook is private and was manually refined after the repository BAS source used during Phase 13 acceptance. The authoritative current callback is:

`Public Sub SyncPortalEntitlements(Optional ByVal control As IRibbonControl)`

The owner’s current workbook copy must be inspected/used for the remaining transport-failure and desktop acceptance gates. Older Library workbook/module copies must not be substituted silently.

## Safety boundary

- No production cutover.
- No general real-student login.
- No DNS/CNAME/production route or existing live-portal change.
- No locked catalogue rewrite.
- No legacy `FPT_LESSONS_TEST` binding.
- No secret/password value in source, logs or chat.
- Excel sync never creates or changes student batch membership.
- Phase 15 is out of scope until Phase 14 is explicitly CLOSED/PASS.
