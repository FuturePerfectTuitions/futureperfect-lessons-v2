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

The branch also carries `.github/workflows/rebuild-checkpoint12-operational-cycle-readonly.yml`, an identity-free production-D1 aggregate detector for the normal CSV lesson-release importer. It emits only counts, distinct lesson counts and timestamp buckets from importer-owned audit/source fields; it emits no pupil identifiers, rejects mutating SQL, never manufactures pupil activity and is structurally incapable of setting `representativeCycleGateMet=true` or authorising CP13. Any non-zero result remains only a candidate until manually validated and followed by the full stabilisation observer.

A separate `.github/workflows/rebuild-checkpoint12-topology-diagnostic-readonly.yml` exists only to diagnose read-path failures without mutating Cloudflare or production. It records expected-vs-observed topology/rollback/data-binding anchors and cannot alter them.

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

## Identity-free normal-import observation — 2026-09-14

To avoid relying on workflow-name heuristics, the CP12 branch added `.github/workflows/rebuild-checkpoint12-operational-cycle-readonly.yml` at commit `c8c40711c67d0d7d6f3d78ec1a62bb33b5d72ce9`. The detector reads aggregate-only production D1 timestamps written by the normal CSV lesson-release importer and cannot close CP12.

Run `34830280662` completed successfully. Its retained artifact is:

- artifact ID: `10341577800`;
- name: `checkpoint12-operational-cycle-readonly-evidence`;
- digest: `sha256:f19ba3e9773bcb0acf48884748b6133d7dcd3763721372e640c464aa241f0a22`.

The exact post-cutover aggregate result was:

- normal full-release importer rows confirmed after cutover: `0`;
- distinct full-release lessons confirmed after cutover: `0`;
- online PreLesson importer rows confirmed after cutover: `0`;
- distinct online PreLesson lessons confirmed after cutover: `0`;
- pupil/student identity fields emitted: `false`;
- candidate real operational activity observed: `false`;
- `representativeCycleGateMet = false`;
- `cp13Allowed = false`.

This directly corroborates the manual exclusion of the CP9/UAT Actions candidate: as of this observation there is still **no genuine normal CSV release/import cycle after cutover**. No pupil mutation was generated to satisfy the gate.

A temporary one-shot repository-maintenance workflow was attempted only to repair the full observer's stale status-literal self-check. Its workspace patch step succeeded, but its repository-write step failed; it made no production change. The temporary write-capable workflow was removed. The stale observer status self-check was then corrected directly, while retaining the observer's read-only permissions and mutation guard, at commit `8a86f0114c79394be866d4fd98119eeb2b05a7a3`.

## Fresh full read-only stabilisation observation — 2026-09-14

The observer run at exact SHA `8a86f0114c79394be866d4fd98119eeb2b05a7a3` is run `34830592811`.

Attempt 1 passed the observer immutability guard, retained-source checks, CP11 frozen-invariant validation, the full authentication/capability/compatibility/publishing regression suite, live parity, VR How-To special-area checks, and candidate Student/Browser health. It then failed only because the observer's unauthenticated GitHub REST read of the legacy frontend `main` branch returned HTTP `403`. The failure occurred before topology evidence assembly; no production mutation occurred.

A dedicated read-only topology diagnostic was added at commit `c857b2c79d6c07211fa9f5e083364130587776eb` and run as `34830839522`. It completed successfully. Artifact:

- artifact ID: `10341822957`;
- name: `checkpoint12-topology-diagnostic-readonly`;
- digest: `sha256:2762881dd8ee86b6368c196a6722a49b190dceb8b13b52dde6bcda3ef37315b3`.

That diagnostic proved there was **no topology or rollback drift**: production DNS, Worker route, legacy Worker deployment/version, candidate Student deployment/version, candidate Browser deployment/version, legacy frontend `main`, all required retained KV/D1/R2 bindings, and direct authoritative-edge behaviour all matched the frozen CP11 anchors exactly.

The same full observer job was then rerun on a fresh runner. Attempt 2 completed **SUCCESS** and produced:

- artifact ID: `10341514063`;
- name: `checkpoint12-stabilisation-observation-evidence`;
- digest: `sha256:a0a79885b9c6fcc67b959d25e9a9616b27aa0b7a2201c365e3d75a22d8f3a9c5`;
- evidence marker: `REBUILD_CHECKPOINT12_OBSERVATION_PASS`;
- observed SHA: `8a86f0114c79394be866d4fd98119eeb2b05a7a3`;
- observation timestamp: `2026-09-14T10:02:57Z`.

Attempt 2 re-established all required current point-in-time evidence:

- full live parity: PASS — `372` lessons, `0` resource mismatches, `23` current students, `0` unexplained student differences;
- VR How-To: PASS — `3` current profiles, `manual=3`, `direct=0`;
- candidate Student/Browser health: PASS — Student health `200`, Browser root `200`, unauthenticated Student API `401`, service-binding facade present;
- authentication/capability/compatibility/publishing/read-model regressions: PASS;
- authoritative Cloudflare topology/direct edge: PASS;
- legacy Worker rollback deployment/version: unchanged;
- candidate Student and Browser deployments/versions: unchanged;
- legacy frontend `main`: unchanged at `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`;
- all required retained KV/D1/R2 bindings: present;
- exact CP11 execution invariants: revalidated;
- no pupil mutation performed.

The Actions-name heuristic still reports only run `34824632012`, the already-validated CP9 production-shaped staging/UAT run. It remains excluded. The stronger production-D1 importer detector remains the governing operational-cycle evidence and had found zero genuine post-cutover normal importer activity.

Therefore after this fresh observation:

- `initialObservationStatus = PASS`;
- `representativeCycleGateMet = false`;
- `cp13Allowed = false`;
- CP12 remains **OPEN**.

### Outstanding stabilisation evidence

The repeated observer evidence proves a clean point-in-time state, but it still does **not** prove sustained clean operation through genuine representative normal release/import cycles. Before CP12 can close, evidence must cover genuine representative normal release/import activity and subsequent clean operation, including the required absence of material server errors/timeouts, snapshot or catalogue-build failures, protected-view failures and resource-load failures during the representative observation window.

No synthetic pupil mutation is to be created merely to satisfy that gate. CP13 remains prohibited until this evidence exists and CP12 is formally recorded CLOSED — PASS.
