# Checkpoint 13 — Legacy Retirement Inventory

Status: **IN PROGRESS — inventory before deletion**

Base authority commit: `78094810cf96e5555e7af3e453d9e1f95e496852` (CP12 CLOSED — PASS)

CP13 branch: `rebuild/checkpoint13-legacy-retirement-2026-09-15`

## Gate discipline

No candidate may be deleted merely because it is old. Each DELETE decision requires proof of repository references, runtime reachability, data consumers, rollback dependencies, and an explicit regression/closure test. Source deleted during CP13 remains recoverable from the immutable CP12 closure commit and Git history. Useful audit/history data is not a deletion target.

## Fresh pre-mutation runtime evidence

A fresh read-only CP12 stabilisation observer was run before CP13 mutation. After one transient Cloudflare API connection reset during the read-only 372-lesson oracle, an immediate rerun completed successfully. The successful rerun verified:

- `lessons.futureperfect.education` is routed only to the rebuilt Browser Worker;
- Browser has exactly one service binding to the rebuilt Student Worker and no AdminOps binding;
- 372-lesson KV oracle passed;
- authenticated admin/student smoke passed;
- importer batch/view guard passed;
- security/architecture assertions passed;
- active Browser and Student rollback versions remained retained/deployable.

The owner also reported that a genuine post-CP12-closure live CSV upload worked. This is recorded only as owner-confirmed operational evidence; no additional details are inferred.

## Candidate inventory

| Candidate | Reference / runtime evidence | Data consumer / rollback evidence | Decision | Required proof/test |
|---|---|---|---|---|
| Legacy session/activity machinery in rebuilt Student hot path | `rebuild/student/src/lib/runtime.mjs` health contract reports `d1SessionLookup:false` and `activityWrites:false`; current Student runtime uses signed first-party cookie auth and prepared read models. | Current public student traffic reaches rebuilt Student only. Historical legacy source remains at CP12 anchor. | **RETAIN legacy-side / already absent from rebuilt hot path** | Final observer must continue proving signed-cookie auth, no request-time D1 session lookup/activity writes, and Browser→Student-only topology. |
| `student_session_profiles` projection/cache (`worker/src/phase11-session-profile.js`) | Still imported by `worker/src/index-phase11-efficient.js`. The deployed legacy Worker remains operationally reachable through the admin CSV importer, so the underlying wrapper chain cannot yet be proved unreachable. | Module reads/writes `student_session_profiles`; deleting while the chain remains an operational importer dependency is not proved safe. CP12 retains source. | **DEFER / RETAIN** | Do not delete unless the importer is migrated or exact-path execution proves this layer cannot be reached by all remaining legacy Worker consumers. |
| Production KV audit proxy (`worker/src/phase11-kv-audit.js`) | Still imported by `worker/src/index-phase11-efficient.js`. Although audit headers are exposed only in development, the module itself sits beneath an operational legacy chain. | No need to delete to protect rebuilt Student traffic because rebuilt Student has no such proxy. | **DEFER / RETAIN** | Delete only after exact legacy consumer reachability is eliminated or bypass proved for all remaining calls. |
| Deployed Phase wrapper chain (`worker/wrangler.toml` → `index-phase23-protected-view-stability.js` → Change20/19/18/17/… chain) | `worker/wrangler.toml` still names Phase23. Root `admin-import.html` points at `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`; `assets/admin-import.js` calls `/api/v1/admin/lesson-releases/login|preview|confirm`. Phase23 delegates to Change20→Change19→Change18→Change17-parent-email; Change17-parent-email imports the admin lesson-release handler; Change14 intercepts the Year 4 11+ guard and delegates preview/confirm downchain. Owner’s genuine CSV upload succeeded after CP12 closure. | This is not on public student traffic, but remains a current operational admin-import path. Deleting/decommissioning it would violate the unused proof gate. | **DEFER / RETAIN** | Migrate/replace admin importer first, or prove all remaining workers.dev admin calls no longer depend on the chain. No forced retirement in CP13. |
| Legacy dual-write compatibility (`rebuild/adminops/src/lib/compatibility.mjs` and reconciliation helpers) | `rebuild/adminops/src/index.js` still imports it and exposes staging-only synthetic compatibility endpoints gated by `ENVIRONMENT=staging`, `COMPAT_TEST_ENABLED=true`, bindings and test secret. | It remains a current validation harness even though it is not on the Student hot path. | **DEFER / RETAIN** | Delete only when the compatibility harness itself is formally retired and no validation workflow consumes it. |
| Legacy frontend phase patches/CSS in accepted frontend repository | CP11/CP9 provenance pins the accepted Vite frontend to `FuturePerfectTuitions/futureperfect-lessons-test@a4513da67ee66f51212114620c8e401bd5e31a8c`. That repository still contains historical `assets/phase*.js/.css`, but the active Vite source is `src/app.js` + `src/styles.css`; `src/app.js` does not import those phase assets. | The separate frontend repository is outside this CP13 source branch. Its historical files are not a reason to mutate another repository during this checkpoint. | **RETAIN external history / active build already consolidated** | Final Browser/source provenance must continue to identify the built Vite entrypoint rather than historical root phase pages. |
| Global PDF.js residue | Accepted Vite source declares `pdfjs-dist`, but `src/app.js` performs `await import('./protected-viewer.js')` only after successful Answer Pack password authorization. `src/protected-viewer.js` is the only protected viewer module that imports PDF.js. | PDF.js is therefore lazy protected-viewer code, not a global Student bootstrap dependency. | **RETAIN required lazy viewer / no global residue in active source** | Final frontend/source verification must confirm PDF.js is absent from initial app imports and remains dynamically loaded only for protected viewer. |
| Obsolete deployment workflows | Multiple Phase-era workflows are still present and can deploy obsolete development/legacy architectures. Example: `phase9-cloudflare-apply.yml` is PR-triggered from `ops/phase9-cloudflare-apply`, expects `ENVIRONMENT=development`, `fpt-materials-dev`, and old `worker/src/index-phase9.js`; `phase10-cloudflare-apply.yml` similarly deploys the Phase10 development worker and requires the old Phase10 entrypoint. | These workflows are not part of current Browser→Student production topology or current admin CSV execution. Source remains recoverable at CP12 anchor. | **DELETE in small proven batches** | For each batch: inspect triggers/targets, ensure no current workflow_call dependency, delete only obsolete deploy/apply workflows, then run CP13 static regression and fresh production-safe observer. |
| Useful audit/history data | CP13 authority explicitly says retain unless separately approved for migration/archive. | Potential operational/history value. | **RETAIN** | No destructive data migration/drop in CP13. |

## Rollback anchors

Minimum retained source anchor throughout CP13:

- CP12 closure commit: `78094810cf96e5555e7af3e453d9e1f95e496852`.
- Git history containing every removed workflow/source file.
- Cloudflare Browser and Student rollback versions verified again immediately before final CP13 closure.
- Legacy Worker is itself retained while the live admin CSV importer still consumes its workers.dev API.

## Closure rule

CP13 may be marked `CLOSED — PASS` only when every actual deletion has proof of non-use, current-source regressions pass, the final production-safe observer passes, exact final source diff is recorded, and rollback anchors remain preserved. Candidates explicitly marked RETAIN/DEFER are not to be force-deleted merely to increase cleanup scope.
