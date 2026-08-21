# Future Perfect Tuitions — Student Portal V2

Isolated development repository for the next-generation Future Perfect Tuitions student portal.

## Completed status

### Phase 1 — COMPLETE

Isolated V2 infrastructure verified end-to-end:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

### Phase 2 — COMPLETE

V2 data foundation and idempotent Student + Lesson entitlement model verified with dummy data.

### Phase 3 — COMPLETE

One complete real-shaped Maths lesson works end-to-end for the development student.

Canonical proof lesson:

- internal lesson key: `lesson:Y5M1`;
- canonical entitlement: `test0101 + Y5M1`.

### Phase 4 — COMPLETE

Secure student authentication/session behaviour verified:

- case-insensitive username;
- agreed 4-character login password;
- opaque HttpOnly/Secure session cookie;
- hashed D1 token storage;
- exactly one active session per Portal User ID — latest login wins;
- two-hour sliding inactivity timeout;
- logout and expiry invalidation;
- development login allowlist;
- withdrawn/expired locked-account behaviour.

### Phase 5 — COMPLETE

The real V2 visual shell is implemented and browser-verified at `phase5.html`.

Verified FPT identity, familiar Student Login, Maths/English top-level choices, password eye, first-name greeting, logout, responsive styling and the full airmail border.

### Phase 6 — COMPLETE

Curriculum navigation is implemented and browser-verified at `phase6.html`.

Verified:

- Login → Maths/English → Year or Level → continuous lesson list;
- normal Maths uses Year presentation;
- 11+ Maths uses Level presentation;
- English uses Year / Year 11+ presentation;
- no Current/Previous grouping;
- no term-section headings;
- no internal Batch ID shown;
- canonical Year/Level de-duplication;
- Worker-authoritative cross-subject locked previews;
- historical Full Library continuity;
- 11+ start-point missed-lesson locked preview;
- future/unreleased lesson hiding;
- lesson-list search;
- student-facing Year/Level lesson IDs.

Example shared canonical Maths lesson:

- normal Year 5 student sees `Y5T1M01 Number and Place Value I`;
- Level 2 / 11+ student sees `L2T1M01 Number and Place Value I`;
- canonical/internal entitlement key remains one shared lesson (`Y5M1` in the current proof data).

Authenticated navigation API:

- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`

D1 migration installed:

- `worker/migrations/0004_curriculum_start_points.sql`

Detailed verification:

- `docs/data/PHASE6_VERIFICATION.md`
- `docs/data/PHASE6_PERSONA_FIXTURES.md`

Normal real-student login remains deliberately disabled during development.

## Development URLs

Main development status:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`

Phase 3 lesson proof:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`

Phase 4 authentication proof:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`

Phase 5 student shell:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase5.html`

Phase 6 curriculum navigation:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase6.html`

## Worker

Worker name:

`fpt-portal-v2-worker`

Worker URL:

`https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

Canonical Worker source:

`worker/src/index.js`

Current development routes include:

- `GET /api/health`
- `GET /api/dev/phase2`
- `GET /api/dev/phase3`
- `GET /api/dev/phase3/resource`
- `POST /api/dev/phase3/answer`
- `POST /api/v1/student/auth/login`
- `POST /api/v1/student/auth/logout`
- `GET /api/v1/student/session`
- `POST /api/v1/student/session/activity`
- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`
- `GET /api/dev/phase4`
- `GET /api/dev/phase4/resource`
- `POST /api/dev/phase4/answer`

## Cloudflare resources

| Binding | Resource |
|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` |
| `DB` | `fpt_portal_v2_db` |
| `MATERIALS_R2` | `fpt-materials-dev` |

Environment variables include:

- `ENVIRONMENT=development`
- `ALLOWED_ORIGINS=https://futureperfecttuitions.github.io`
- `DEV_LOGIN_ALLOWLIST=test0101,test0202,test0303` during Phase 6 development testing.

Normal student login remains disabled server-side.

## D1 migrations

- `worker/migrations/0001_lesson_entitlements.sql`
- `worker/migrations/0002_student_sessions.sql`
- `worker/migrations/0003_single_active_student_session.sql`
- `worker/migrations/0004_curriculum_start_points.sql`

## Documentation

- `IMPLEMENTATION_HANDOVER.md`
- `docs/data/STUDENT_KV_FORMAT.md`
- `docs/data/LESSON_KV_FORMAT.md`
- `docs/data/PHASE2_SETUP.md`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `docs/data/PHASE4_VERIFICATION.md`
- `docs/data/PHASE5_VERIFICATION.md`
- `docs/data/PHASE6_VERIFICATION.md`
- `docs/data/PHASE6_PERSONA_FIXTURES.md`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

## Next phase

**Phase 7 — Build the Complete Lesson Page Renderer.**

Phase 7 must begin in a new chat after reading the latest Master Authoritative Specification v2.3, Steps to Progression v1.3 and cumulative Implementation Handover v3.4, then reconnecting to GitHub and inspecting the actual implementation state.
