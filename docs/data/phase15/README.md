# Phase 15 — Student Persona Acceptance Closure

Status: **CLOSED / PASS**

Owner acceptance: **ACCEPTED on 2026-08-28**.

Authoritative baseline:
- Phase 14 merged main: `525a496ef39f43dfd60241e5f031ea96b451151e`
- Master: FPT Portal V2 — Master Authoritative Specification v3.3
- Steps: FPT Portal V2 — Steps to Progression v2.3
- Handover: FPT Portal V2 — Implementation Handover v4.5
- Canonical catalogue: 369 lessons / 11 curricula
- Catalogue SHA-256: `7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663`

## Final acceptance evidence

Final exact-head Phase 15 acceptance run: GitHub Actions run `33170735307` on head `983934e9a6c56045a54ccef0765625a1ce006a54` — **SUCCESS**.

The final run passed:
- static and inherited regression gates;
- guarded isolated development Worker deployment gate;
- isolated P24 manual individual access diagnostic;
- full controlled persona matrix, including effective-dated membership, retained history, Full Library, ordinary/11+, VR eligible/ineligible, VR How-To, Assessments, MOCKS locked/no-leak presentation, one-off/manual individual access, multi-current same-subject assignments, session security and protected Answer Pack lifecycle;
- established deployed API regression;
- real Google Chrome acceptance;
- browser screenshot evidence upload;
- controlled session cleanup; and
- final exact read-only baseline verification.

Browser evidence artifact: `phase15-persona-browser-screenshots` from run `33170735307`, artifact id `9685667810`, digest `sha256:96a5883f4d4c5ffc7041e756552647173500a9b213d1a363a3e20efc88dd8824`.

## Persona results

The Phase 15 matrix P01–P25 is accepted against the Master rules. Important live proofs include:
- P06 English 11+ core access without VR leakage — PASS.
- P09 mid-term join / effective-from gate — PASS.
- P10 transfer / history / no earlier-batch inheritance — PASS.
- P11 leave and rejoin retained access — PASS.
- P12 stop one subject while retaining earned history — PASS.
- P13 ordinary Full Library — PASS.
- P14 11+ Full Library / VR separation — PASS.
- P15–P17 authorised special-area presentation gates — PASS, with Phase 15 live MOCKS proof limited to locked/no-leak behaviour and accepted earlier positive/negative password proof left unmutated.
- P18 opaque session, exactly-one-active-session, logout and two-hour inactivity — PASS.
- P19 controlled login reset effects — PASS.
- P20 protected Answer Pack / Key lifecycle — PASS.
- P23 assignment-only release gate / absence independence — PASS.
- P24 one-off/manual individual lesson access without D1 membership mutation — PASS.
- P25 simultaneous active batches in the same subject all represented as Current — PASS.

## Defects corrected during Phase 15

1. VR How-To now requires its separate manual special-bucket authorisation as well as eligible English 11+ presentation context.
2. Visible Year/Level views now retain the full canonical lesson catalogue, with missing entitlements shown locked rather than omitted.
3. Multiple active batches in the same subject can all be Current simultaneously.
4. Explicit 11+ Full Library access is no longer suppressed by an ordinary retained view sharing the underlying curriculum.
5. Manual individual core lesson access can surface the appropriate historical ordinary Year view without fabricating D1 entitlement or batch membership.
6. Browser acceptance now follows the current lesson-video presentation by selecting the explicit View control before inspecting the player.

## Baseline restored

The final acceptance run restored and re-verified the accepted Phase 14 operational baseline:
- `632` lesson entitlements;
- `4` batch definitions;
- `4` student batch assignments;
- `0` batch lesson releases;
- `2` assigned real development users;
- `173` entitlements belonging to assigned users;
- no Phase 15 temporary batch, assignment, release or entitlement fixtures;
- `trg_student_sessions_single_active` present;
- D1 `quick_check = ok`;
- isolated Worker remains `development`;
- development R2 binding remains `fpt-materials-dev`; and
- normal student login remains disabled.

No production login, DNS/CNAME, production route, cutover, legacy `FPT_LESSONS_TEST` binding, canonical catalogue rewrite, Excel membership mutation or Phase 16 work is included in this closure.

## Closure decision

All required Phase 15 static, API, D1, browser and owner-acceptance gates are satisfied. Phase 15 is therefore **CLOSED / PASS** and PR #125 is eligible to be marked ready and merged into `main` after the closure-record commit itself passes the applicable repository checks.
