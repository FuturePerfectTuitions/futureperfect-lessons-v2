# Checkpoint 13 — Legacy Retirement Inventory and Closure Record

**Status: CLOSED — PASS**

Date: 2026-09-15

Base authority commit: `78094810cf96e5555e7af3e453d9e1f95e496852` (CP12 CLOSED — PASS)

CP13 branch: `rebuild/checkpoint13-legacy-retirement-2026-09-15`

Technical closure candidate observed at: `290c4cb929791f7f73c93595898cbe911e035027`

## Gate discipline

No candidate was deleted merely because it was old. Every deletion required proof of repository references, runtime reachability, data consumers, rollback dependencies, and an explicit regression/closure test. Source deleted during CP13 remains recoverable from the immutable CP12 closure commit and Git history. Useful audit/history data was not a deletion target.

## Fresh pre-mutation runtime evidence

A fresh read-only production observation was run before CP13 mutation. After one transient Cloudflare API connection reset during the read-only 372-lesson oracle, an immediate rerun completed successfully. The successful rerun verified:

- `lessons.futureperfect.education` was routed only to the rebuilt Browser Worker;
- Browser had exactly one service binding to the rebuilt Student Worker and no AdminOps binding;
- the 372-lesson KV/current-source oracle passed;
- authenticated Admin/student smoke passed;
- importer batch/view guard passed;
- security/architecture assertions passed; and
- active Browser and Student rollback versions remained retained/deployable.

The owner also reported that a genuine post-CP12-closure live CSV upload worked. This is retained as owner-confirmed operational evidence only; no additional details are inferred.

## Candidate inventory and final decisions

| Candidate | Evidence | Final decision |
|---|---|---|
| Legacy session/activity machinery in rebuilt Student hot path | `rebuild/student/src/lib/runtime.mjs` reports `d1SessionLookup:false` and `activityWrites:false`; current public Student traffic uses the rebuilt signed-cookie/prepared-read-model runtime. | **Already absent from rebuilt hot path; retain historical legacy-side implementation while legacy importer Worker remains operational.** |
| `student_session_profiles` projection/cache (`worker/src/phase11-session-profile.js`) | Still imported by `worker/src/index-phase11-efficient.js`, which remains beneath an operational legacy Worker chain used by the admin CSV importer. | **DEFER / RETAIN.** Not proved unused. |
| Production KV audit proxy (`worker/src/phase11-kv-audit.js`) | Still imported by `worker/src/index-phase11-efficient.js`. Rebuilt Student does not use it, but the legacy chain remains operational. | **DEFER / RETAIN.** Not proved unused for all legacy consumers. |
| Deployed Phase wrapper chain (`worker/wrangler.toml` → Phase23 → Change20/19/18/17/… chain) | `admin-import.html` still targets `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`; importer calls legacy admin release APIs; Change17-parent-email retains the lesson-release handler and Change14 delegates importer calls down-chain. | **DEFER / RETAIN.** It is a current admin-import dependency, not dead code. |
| Legacy dual-write compatibility (`rebuild/adminops/src/lib/compatibility.mjs`) | Still imported by AdminOps and used by the staging-only compatibility harness. | **DEFER / RETAIN.** Current validation dependency. |
| Historical frontend phase patches/CSS in `futureperfect-lessons-test` | Accepted Vite source uses `src/app.js` + `src/styles.css`; historical root `assets/phase*.js/.css` are outside this CP13 repo/branch and are not active Vite imports. | **RETAIN external history; no cross-repository deletion in CP13.** |
| PDF.js | Active frontend dynamically imports `protected-viewer.js` only after Answer Pack authorisation; PDF.js is required by that lazy protected viewer. | **RETAIN.** Required lazy dependency, not global bootstrap residue. |
| Useful audit/history data | May retain operational/history value and had no separate migration/archive approval. | **RETAIN.** No destructive data cleanup in CP13. |
| Obsolete Phase-era deployment/mutation workflows | Exact triggers/guards showed old development-only deployment assumptions incompatible with the current Browser→Student production topology and with the retained production-era legacy importer Worker. No `workflow_call` dependency was found for the retired workflows. | **DELETE — 12 workflows, in three validated batches.** |

## Retired workflows

Exactly 12 obsolete deployment/mutation workflows were removed. No Worker runtime source, pupil/student data, entitlement data, KV/D1/R2 content, production route, binding, secret, active deployment, or rollback version was deleted.

### Batch 1

Commit: `70089a10bd0cab7b38e39d0818bcf2a5bd9d1501`

- `.github/workflows/phase9-cloudflare-apply.yml`
- `.github/workflows/phase10-cloudflare-apply.yml`
- `.github/workflows/phase10-history-cloudflare-apply.yml`

The CP13 validation workflow was then added and corrected for full-history checkout/source formatting. Clean validation run: `34963836626` — PASS.

### Batch 2

Commit: `18a6765b8b010924324dbb9eb8e5673989d42c5e`

- `.github/workflows/phase11-worker-performance-deploy.yml`
- `.github/workflows/phase11-session-efficiency-deploy.yml`
- `.github/workflows/phase12-batch-aware-deploy.yml`
- `.github/workflows/phase13-excel-sync-deploy.yml`
- `.github/workflows/phase15-guarded-development-deploy.yml`

Exact-SHA validation run: `34963926990` — PASS.

### Batch 3

Commit: `55e9006c136358b7bfd096225e58645f36cd5e89`

- `.github/workflows/phase11-cloudflare-apply.yml`
- `.github/workflows/phase11-quota-safe-worker-deploy.yml`
- `.github/workflows/phase11-change7-owner-homeworks-apply.yml`
- `.github/workflows/phase11-vr-howto-real-catalogue-apply.yml`

Exact-SHA validation run: `34964279842` — PASS.

The validation gate proved all 12 files are absent from the CP13 branch but still recoverable from the immutable CP12 source anchor.

## Final read-only production observer

A dedicated current-source observer was added at `290c4cb929791f7f73c93595898cbe911e035027` as `.github/workflows/rebuild-checkpoint13-final-readonly-observer.yml`.

Static retirement/regression validation run `34964601844` completed **PASS**.

Final production observer run `34964601925` completed **PASS**. Evidence artifact:

- artifact ID: `10394955774`;
- name: `checkpoint13-final-readonly-observer-evidence`;
- digest: `sha256:6ec655df9435a26e75f41693fb5a9dd60859f031bd65d1031ee4261edd134ccf`;
- marker: `REBUILD_CHECKPOINT13_FINAL_OBSERVER_PASS`;
- observed SHA: `290c4cb929791f7f73c93595898cbe911e035027`;
- observed at: `2026-09-15T11:41:43Z`;
- read-only: `true`.

The observer established after all workflow deletions:

- retirement integrity: PASS — `12` retired workflows, all recoverable from CP12, legacy importer retained;
- architecture: PASS — Browser→AdminOps `false`, `d1SessionLookup=false`, `activityWrites=false`, importer batch/view guard intact;
- exact current-source production oracle: PASS — `372` lesson scopes, `0` resource mismatches;
- exact resource census: `1509` total = `984` core + `212` 11+ + `313` VR;
- VR How-To: `manual=3`, `direct=0`;
- canonical topology: PASS — Browser→Student service binding only, no Browser→AdminOps path;
- active Browser version: `67880177-1328-46dd-a228-47ba245e33ae`;
- active Student version: `32467053-f348-449c-a2ae-1dae9688b446`;
- retained legacy importer Worker version: `b1c8326e-a9cc-4150-b43b-cc572a4404c1`;
- Browser rollback version `412d5dd1-8f36-4e84-b5b6-eba39c670820`: retained/deployable;
- Student rollback version `bed8e660-facb-47f3-afad-7a9996d95c5a`: retained/deployable;
- legacy importer KV/D1/R2 bindings: retained;
- public root/API Browser facade: PASS;
- authenticated Admin smoke: login/home/Maths/year-or-level/lesson PASS;
- representative student smoke: PASS;
- credentials/cookies/passwords logged: `false`;
- retained Admin import continuity/static verification: PASS.

## Exact CP12 → CP13 source diff

The compare from CP12 closure anchor `78094810cf96e5555e7af3e453d9e1f95e496852` to the observed technical closure candidate `290c4cb929791f7f73c93595898cbe911e035027` is strictly scoped to 15 paths:

- **12 removed files** — exactly the obsolete workflows listed above;
- **1 added CP13 static validation workflow** — `.github/workflows/rebuild-checkpoint13-legacy-retirement-validation.yml`;
- **1 added CP13 final read-only observer** — `.github/workflows/rebuild-checkpoint13-final-readonly-observer.yml`;
- **1 added/updated closure record** — this document.

There are **no runtime source-code changes** in the CP12→CP13 product/runtime diff. No production code path was altered to manufacture retirement; only proved-obsolete deployment/mutation workflows were removed and CP13 evidence/validation files were added.

## Rollback and operational anchors retained

- Immutable CP12 source anchor: `78094810cf96e5555e7af3e453d9e1f95e496852`.
- Every retired workflow remains recoverable from that source anchor and Git history.
- Browser rollback version retained/deployable: `412d5dd1-8f36-4e84-b5b6-eba39c670820`.
- Student rollback version retained/deployable: `bed8e660-facb-47f3-afad-7a9996d95c5a`.
- Current Browser/Student/legacy Worker versions remained unchanged through the final observer.
- The legacy Worker and its required bindings remain retained because the live admin CSV importer still consumes its `workers.dev` API.
- Current importer-maintenance workflows, including `change17-parent-email-production-deploy.yml` and `y411-admin-import-production-deploy.yml`, remain present.

## Closure decision

All actual CP13 deletions have proof of non-use/incompatibility with the current deployment model, each retirement batch passed regression validation, the final current-source production observer passed after all deletions, the exact source diff contains no runtime-code mutation, and rollback plus importer-operational anchors remain preserved.

Candidates marked RETAIN/DEFER were deliberately **not** force-deleted.

**CP13 CLOSED — PASS.**
