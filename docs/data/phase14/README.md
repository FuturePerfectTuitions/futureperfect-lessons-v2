# Phase 14 — deliberate Excel failure/retry/correction matrix

Status: **CLOSED / PASS**. Phase 13 remains the starting checkpoint. Phase 15 has not started and must begin only in a new chat from the Phase 14 closure checkpoint.

## Starting evidence boundary

Phase 14 started from the formally closed Phase 13 `main` SHA `458a67cee0f20b21a6083e7073190cfe14628867` (PR #122 merged). A fresh preflight confirmed `main` was still exactly that SHA before Phase 14 work began.

The initial read-only Cloudflare audit confirmed the deployed V2 Worker remained isolated in development: `ENVIRONMENT=development`, normal student login disabled, development R2 `fpt-materials-dev`, expected V2 KV/D1 bindings, dedicated Excel sync secret present by name only, and no legacy `FPT_LESSONS_TEST` lesson binding. No production route, DNS, live portal or normal-login change was made.

## Credited Phase 13 evidence

Phase 13 acceptance remained authoritative and was not destructively recreated merely to obtain another green run. Credited behaviours included first Completed release, repeat/status-check idempotency, duplicate Student+Lesson handling, copied Sync Row ID repair, Student/Lesson fingerprint changes without revocation, invalid-lesson independence, effective-dated assignment rejection/retry, moved lesson date, late-added lesson, manual block/unblock and exact TestY cleanup.

## Phase 14 backend matrix — PASS

The final guarded backend acceptance passed on GitHub Actions run **33060941602**. It proved, in the isolated development environment:

- Full Library alone does not make an unsynced Excel source row confirmed;
- explicit Excel sync still creates/confirms the independent direct Student+Lesson entitlement when Full Library already grants portal access;
- ordinary Maths creates core access only;
- ordinary English creates core access only;
- first valid English 11+ release to a VR-eligible student creates core + VR access;
- one invalid item does not block valid items in the same request;
- deliberate per-item runtime/store failure remains retryable and does not create an unintended entitlement;
- duplicate Student+Lesson remains idempotent;
- Excel sync introduces no entitlement-revocation path and no batch-membership mutation path.

The inherited regression suite also passed the locked catalogue/hash, session/single-device, protected-answer, ScreenPal/11+, VR HowTo/VR video policy, special-content and development-isolation checks.

## Owner desktop Excel acceptance — PASS

The owner’s actual current macro-enabled workbook was used, rather than an older repository/Library workbook copy.

### Controlled Worker/API unavailable path

A temporary development-only failure was narrowly scoped to the exact TestY Phase 14 request. The owner ran the normal workbook Sync button while the computer remained online. Excel reported **0 confirmed / 1 failed**, and the guarded backend check proved the request created no entitlement and no batch release. The temporary failure was then removed and the canonical Phase 13 development Worker restored before retry.

This satisfies the authoritative Phase 14 **Worker/API unavailable** branch. A literal physical network/TCP disconnect was not used; it was not required because the acceptance criterion is Worker/API unavailable **or** network/runtime failure.

### Retry and mixed-result matrix

After canonical Worker restoration:

- retry of the same Maths row succeeded and became green + bold;
- ordinary English succeeded;
- English 11+ + VR succeeded;
- Full Library overlap succeeded;
- deliberate nonexistent lesson `Y3M999` failed independently;
- the four-row mixed request produced **3 confirmed / 1 failed**, proving a bad item did not block valid rows;
- backend read-only verification showed exactly four expected temporary entitlements and four expected batch releases, correct VR flags, Full Library preserved, and no invalid entitlement.

### Failed-row formatting defect found and corrected

Phase 14 exposed a workbook defect: `P13_ClearWorkflowColour` used `xlThemeColorAccent6`, which rendered failed/unconfirmed rows green in the owner workbook even though they were not bold and were correctly counted as failures.

The accepted VBA correction is:

```vb
Private Sub P13_ClearWorkflowColour(ByVal target As Range)
    target.Interior.Pattern = xlNone
    target.Font.Color = RGB(0, 0, 0)
    target.Font.Bold = False
End Sub
```

Owner desktop acceptance then proved a deliberately failed row remained **black + non-bold** after the macro processed it. Confirmed/created remains **green + bold** and manually blocked remains **red + bold**, all with no status fill.

The public ribbon callback remains exactly:

`Public Sub SyncPortalEntitlements(Optional ByVal control As IRibbonControl)`

### Final idempotency proof

The owner synced the already-entitled valid Maths row again. Excel confirmed the row successfully and the backend pre-cleanup check proved there was still **exactly one** `testy3p14m + Y3M1` entitlement.

## Email Database → Live N/Q continuity

The accepted workbook now uses the same Name + Subject + Day + Time membership match for the Live table’s calculated columns:

- **N / Batch ID** pulls Email Database column H;
- **Q / Portal User ID** pulls Email Database column K.

The owner’s newly added Abigail record was verified with `Q = Abi3007`. Existing Live N/Q data rows contain the new multi-criteria formulas. The final workbook package also corrects the Live table’s stored calculated-column metadata so new table rows inherit the same N/Q logic rather than the superseded name-only VLOOKUP.

Final Phase 14 workbook artifact: `FuturePerfectLive_2026-27_Phase14_FINAL.xlsm`.

Final artifact SHA-256: `45e53026d3434a40070e098c103a53dd4e027c3073d6c858f44ab060140cb77e`.

The final metadata correction did not alter `xl/vbaProject.bin`; its SHA-256 remains `862bef54848e4d939a568755f471d04d2e2090ed5788a99a029a369720bc2f06`.

## Exact fixture cleanup — PASS

GitHub Actions run **33072650628** first reconfirmed desktop idempotency, then removed only the exact four Phase 14 TestY users/assignments/entitlements/releases. It restored the documented Phase 13 baseline exactly:

- 632 lesson entitlements;
- 4 batch definitions;
- 4 student batch assignments;
- 0 batch lesson releases;
- 2 assigned real development users;
- 173 entitlements belonging to those assigned users;
- 0 Phase 14 TestY entitlements;
- 0 Phase 14 TestY assignments;
- 0 Phase 14 TestY releases;
- all four temporary TestY KV user keys absent;
- single-device trigger present;
- D1 `PRAGMA quick_check = ok`.

## Final read-only closure preflight — PASS

GitHub Actions run **33072808234** passed the final read-only static/inherited regression and environment verification after cleanup. It reconfirmed:

- locked catalogue hash `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663`;
- Phase 14/13/12 regression gates;
- session/single-device rules;
- protected Answer Pack behaviour;
- ScreenPal/11+ and VR rules;
- Full Library source rules;
- development Worker isolation;
- normal student login disabled;
- development R2 `fpt-materials-dev`;
- dedicated Excel sync secret present by name only;
- legacy `FPT_LESSONS_TEST` not used as the Worker lesson binding;
- D1 exact 632/4/4/0 baseline;
- TestY fixtures absent;
- D1 `quick_check` PASS.

## Safety boundary preserved

- No production cutover.
- No general real-student login.
- No DNS/CNAME/production route or existing live-portal change.
- No locked catalogue rewrite.
- No legacy `FPT_LESSONS_TEST` binding.
- No secret/password value committed, logged or disclosed.
- Excel sync does not create/change batch membership.
- Student+Lesson entitlement remains permanent/idempotent and is not auto-revoked by this workflow.

## Closure decision

**Phase 14 is formally CLOSED / PASS.**

Phase 15 is the next implementation phase. It must not be started in this Phase 14 chat. The Phase 14 merged `main` SHA is the required next-chat checkpoint and must be recorded in the Steps to Progression and cumulative Implementation Handover after merge.