# Checkpoint 12 — Stabilisation Period

**Status: OPEN — INITIAL OBSERVATION PASS; REPRESENTATIVE-CYCLE GATE NOT MET**

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

At branch creation the CP12 branch was exactly equal to the official CP11-closed SHA `79dce756dfa3e0f2510b8b5afafee87a45d85e22`.

## Initial read-only stabilisation observation — 2026-09-14

The first observer attempt, run `34826821567`, failed in the special-area invocation because the observer supplied an unsupported command-line date argument instead of setting the runtime-gate date environment variables consumed by the existing audit script. The underlying live parity output was already clean (`372` lessons, `0` resource mismatches, `0` unexplained student differences) and the VR How-To audit was already clean (`manual=3`, `direct=0`). No production mutation or repair was performed. The observer invocation alone was corrected.

The corrected observer was committed at `5e61dfdd830ff8eaa1094cb03af59b0ee73d0e0c` and run `34827075618` completed successfully. Its retained artifact is:

- artifact ID: `10340582699`;
- name: `checkpoint12-stabilisation-observation-evidence`;
- digest: `sha256:101616c2e244454f22a2abcf6507bf7391b8c5bf97a2be1b9fdfa0aefd451eb1`.

The corrected observation established the following point-in-time evidence without pupil mutation:

- full live parity: PASS — `372` lessons, `0` resource mismatches, `23` current students, `0` unexplained student differences;
- VR How-To special area: PASS — `3` current profiles, `manual=3`, `direct=0`, CP11 runtime gate enabled and compatible, prepared/live catalogue revision in sync;
- candidate Student Worker health: PASS — production runtime, prepared read models bound, signed-cookie auth active, no D1 session lookup/activity writes, live Answer Pack password/rate stores bound, no R2 HEAD fan-out;
- candidate Browser Worker health: PASS — root `200`, unauthenticated Student API `401`, same-origin service-binding facade present;
- authentication/capability/compatibility/publishing/read-model regression suite: PASS;
- authoritative Cloudflare topology: PASS — production DNS and Worker route still point to the rebuilt browser path and direct authoritative-edge checks served the rebuilt topology;
- candidate Student and Browser deployment/version anchors: unchanged from CP11;
- legacy Worker rollback deployment/version anchor: unchanged from CP11;
- legacy frontend `main` rollback anchor: unchanged at `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`;
- required legacy/current KV, D1 and R2 data bindings checked by the observer: retained;
- exact CP11 execution evidence from run `34823892175`: recovered and revalidated against the frozen security/resource invariants.

### Representative operational-cycle gate

The observer's broad discovery heuristic returned one post-cutover workflow candidate, run `34824632012`, solely because its name contained `Production-shaped`. That run is a **Checkpoint 9 production-shaped staging/UAT run**, not a normal live release/import cycle, and is explicitly excluded from CP12 operational-cycle evidence.

Qualifying representative cycles observed at this checkpoint record:

`1 heuristic candidate - 1 excluded CP9/UAT candidate = 0 qualifying representative cycles`.

Therefore:

- `initialObservationStatus = PASS`;
- `representativeCycleGateMet = false`;
- `cp13Allowed = false`;
- CP12 remains **OPEN**.

The repository's lesson-release/import static-verification workflow is also not counted as operational evidence: it proves implementation/static checks, not that a genuine normal live release/import cycle occurred.

### Outstanding stabilisation evidence

The initial observer proves a clean point-in-time state. It does **not** by itself prove sustained clean operation across the stability window. Before CP12 can close, evidence must cover genuine representative normal release/import activity and subsequent clean operation, including the required absence of material server errors/timeouts, snapshot or catalogue-build failures, protected-view failures and resource-load failures during the representative observation window.

No synthetic pupil mutation is to be created merely to satisfy that gate. CP13 remains prohibited until this evidence exists and CP12 is formally recorded CLOSED — PASS.
