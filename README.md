# Future Perfect Tuitions — Student Portal V2

Isolated development repository for the next-generation Future Perfect Tuitions student portal.

## Phase 1 status — COMPLETE

Phase 1 infrastructure foundation has been built and verified end-to-end.

- V2 repository created separately from the live portal.
- GitHub Pages enabled from `main` / repository root.
- Development frontend is live.
- FPT visual shell started using the existing navy/red/white design language.
- Separate V2 Worker created and deployed.
- Frontend → Worker CORS/connectivity verified.
- `GET /api/health` verifies all configured backend bindings.
- Separate V2 Students KV created and bound as `STUDENTS_KV`.
- Separate V2 Lessons KV created and bound as `LESSONS_KV`.
- Separate V2 D1 database created and bound as `DB`.
- Development R2 materials bucket bound as `MATERIALS_R2`.
- Health test confirms Students KV, Lessons KV, D1 and R2 are all bound and readable/queryable.
- Environment is `development`.
- Student login remains disabled.
- No live custom domain / `CNAME` is configured.
- Existing live portal, Worker and KV namespaces remain untouched.

## Development URL

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`

## Worker

Worker name:

`fpt-portal-v2-worker`

Worker URL:

`https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

Current Worker source:

`worker/src/index.js`

## Cloudflare resources

| Binding | Resource |
|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` |
| `DB` | `fpt_portal_v2_db` |
| `MATERIALS_R2` | `fpt-materials-dev` |

Environment variables:

- `ENVIRONMENT=development`
- `ALLOWED_ORIGINS=https://futureperfecttuitions.github.io`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

## Next phase

Phase 2 — define and implement the V2 data foundations: manual student record format, lesson catalogue format, and the D1 Student + Lesson entitlement table used by Excel.
