# Future Perfect Tuitions — Student Portal V2

Isolated development repository for the next-generation Future Perfect Tuitions student portal.

## Completed status

### Phase 1 — COMPLETE

The isolated V2 infrastructure foundation has been built and verified end-to-end:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

### Phase 2 — COMPLETE

The V2 data foundation has been defined, implemented and tested with dummy data.

Verified:

- Student KV format and key convention.
- Lesson/View/Library KV format and key conventions.
- D1 `lesson_entitlements` table and index.
- Dummy student `student:test0101`.
- Dummy lesson `lesson:DEV-M01`.
- Dummy curriculum view `view:maths-year5-dev`.
- Development diagnostic route `GET /api/dev/phase2`.
- D1 entitlement `test0101 + DEV-M01` reads correctly.
- Duplicate Student + Lesson upsert is idempotent: row count remains 1 while `last_confirmed_at` updates.
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

Current diagnostic routes:

- `GET /api/health`
- `GET /api/dev/phase2` (development only)

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

## Phase 2 data documentation

- `docs/data/STUDENT_KV_FORMAT.md`
- `docs/data/LESSON_KV_FORMAT.md`
- `docs/data/PHASE2_SETUP.md`
- `docs/data/PHASE2_VERIFICATION.md`
- `worker/migrations/0001_lesson_entitlements.sql`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

## Next phase

**Phase 3 — Get One Complete Maths Lesson Working End-to-End.**

Use one real-shaped Maths lesson and one dummy student to prove the full data-driven lesson journey with R2 PreLesson/Homework/Answer Pack and ScreenPal video before loading the real catalogue.
