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
- Duplicate Student + Lesson upsert is idempotent.

### Phase 3 — COMPLETE

One complete real-shaped Maths lesson works end-to-end for the development student.

Proof lesson:

- Lesson: `Y5M1 Number and Place Value I`
- Lesson KV: `lesson:Y5M1`
- View KV: `view:maths-year5`
- ScreenPal: `cOV0omn3XVh`
- Development student: `Test0101`
- D1 entitlement: `test0101 + Y5M1`

Verified student journey:

`Subjects → Maths → Year 5 → Y5M1 → PreLesson Sheet → embedded ScreenPal video → Homework → password-protected Answer Pack`

### Phase 4 — COMPLETE

Secure student authentication/session behaviour is now proven in the isolated development environment.

Verified:

- case-insensitive username login;
- agreed 4-character login-password format;
- opaque `HttpOnly`/`Secure` browser session cookie;
- SHA-256 session-token hash stored in D1 rather than the raw browser token;
- exactly one active session per Portal User ID — latest login wins;
- 2-hour sliding inactivity timeout;
- server-side expiry enforcement;
- logout revokes the D1 session;
- non-allowlisted development users are rejected;
- wrong password is rejected with generic messaging;
- withdrawn/expired students can authenticate but operate in globally locked mode;
- authenticated Phase 4 lesson access remains healthy for the active test student;
- Phase 2 and Phase 3 regressions still pass.

Single-device enforcement is implemented at D1 level by migration `0003_single_active_student_session.sql` and trigger `trg_student_sessions_single_active`, so each new session insert revokes older active sessions for the same Portal User ID.

Normal real-student login remains deliberately disabled during development.

## Development URLs

Main development status:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`

Phase 3 lesson proof:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`

Phase 4 authentication proof:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`

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
- `DEV_LOGIN_ALLOWLIST=test0101`

Normal student login remains disabled server-side.

## D1 migrations

- `worker/migrations/0001_lesson_entitlements.sql`
- `worker/migrations/0002_student_sessions.sql`
- `worker/migrations/0003_single_active_student_session.sql`

## Documentation

- `IMPLEMENTATION_HANDOVER.md`
- `docs/data/STUDENT_KV_FORMAT.md`
- `docs/data/LESSON_KV_FORMAT.md`
- `docs/data/PHASE2_SETUP.md`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `docs/data/PHASE4_VERIFICATION.md`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

## Next phase

**Phase 5 — Build the V2 Visual Shell.**

Carry the established Future Perfect Tuitions visual identity into the real V2 student shell while keeping the Phase 4 authentication/session model and the proven Phase 3 lesson journey intact.
