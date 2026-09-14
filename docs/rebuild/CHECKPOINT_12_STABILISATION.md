# Checkpoint 12 — Stabilisation Period

**Status: OPEN — INITIAL OBSERVATION ONLY**

Date opened: 2026-09-14
Official rebuild baseline: `rebuild/portal-v2-performance-2026-09-13` at `79dce756dfa3e0f2510b8b5afafee87a45d85e22`
Checkpoint branch: `rebuild/checkpoint12-stabilisation-2026-09-14`

## Authority

Checkpoint 12 is governed by the original approved `SAFE_IMPLEMENTATION_PLAN_AND_GATES.md` and `APPROVED_ARCHITECTURE_DECISIONS_1_TO_33.md`, freshly re-read before CP12 mutation.

The CP12 gate is deliberately stronger than launch-day health. CP12 remains OPEN until there is **sustained clean operation through representative normal operational cycles**, including normal release/import activity. A healthy initial observation is necessary but is not sufficient to close CP12.

## Mandatory preservation during the stability window

Until CP12 is genuinely closed:

- legacy Worker/frontend rollback anchors remain intact and recoverable;
- legacy source/data paths remain retained;
- compatibility writes and reconciliation paths remain retained;
- VR How-To remains manual-only (`manual=3`, `direct=0`);
- signed student sessions remain Secure, HttpOnly, SameSite=Lax, 8-hour absolute-expiry sessions with multi-device semantics and one-browser logout;
- there is no per-request D1 session lookup and no per-request activity write;
- scoped capabilities remain at or below five minutes;
- Answer Pack password/rate checks remain live;
- protected-view behaviour remains enforced;
- ordinary resources remain direct-download capable;
- video/provider contact remains lazy and occurs only after View.

No CP13 deletion, retirement, compatibility removal, or rollback-anchor removal is permitted while this checkpoint is OPEN.

## Read-only stabilisation observer

The CP12 branch carries `.github/workflows/rebuild-checkpoint12-stabilisation-observation.yml` as a strictly read-only observer. It is designed to:

1. recover and verify the exact successful CP11 execution evidence from run `34823892175`;
2. re-run the full live parity audit and VR How-To special-area audit;
3. verify the authoritative Cloudflare DNS/Worker-route topology and direct edge behaviour;
4. verify the rebuilt candidate Student/Browser Workers remain healthy;
5. verify the preserved legacy Worker/frontend rollback anchors and required legacy KV/D1/R2 data anchors remain available;
6. run the approved authentication, capability, compatibility, publishing, prepared-read-model and Student Worker regression tests locally;
7. verify the retained legacy/compatibility/reconciliation source paths still exist;
8. observe completed normal operational/release/import-related GitHub Actions activity since CP11 cutover without generating or manufacturing pupil mutations; and
9. produce evidence that explicitly distinguishes `initialObservationStatus` from the still-open `representativeCycleGateMet` closure gate.

The observer has read-only GitHub permissions and contains no deploy, secret-write, Cloudflare write, backfill, cutover, rollback, pupil mutation, or CP13-retirement action.

## Closure criteria

CP12 may be recorded as CLOSED — PASS only when all of the following are evidenced together:

- repeated live parity and special-area observations remain clean;
- no material server-error, timeout, snapshot/catalogue-build, protected-view, or resource-load failure is observed during the stability window;
- normal release/import activity has occurred and the rebuilt production portal remains clean afterwards;
- authentication/capability/compatibility invariants remain intact;
- authoritative topology remains correct;
- rollback anchors and legacy compatibility/data paths remain recoverable throughout the observation window; and
- the evidence demonstrates sustained clean operation, not merely elapsed time or repeated synthetic smoke tests.

## Initial state

At branch creation the CP12 branch was exactly equal to the official CP11-closed SHA `79dce756dfa3e0f2510b8b5afafee87a45d85e22`. The first CP12 observation run will be recorded here after it completes. Regardless of that first observation's result, `representativeCycleGateMet` remains false until representative normal release/import cycles have genuinely been observed.
