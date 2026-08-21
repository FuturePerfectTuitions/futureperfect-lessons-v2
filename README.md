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
- Worker-authoritative cross-subject previews;
- historical Full Library continuity;
- 11+ start-point missed-lesson locked preview;
- future/unreleased lesson hiding;
- lesson-list search;
- student-facing Year/Level lesson IDs.

Example shared canonical Maths lesson:

- normal Year 5 student sees `Y5T1M01 Number and Place Value I`;
- Level 2 / 11+ student sees `L2T1M01 Number and Place Value I`;
- canonical/internal entitlement key remains one shared lesson (`Y5M1` in the current proof data).

### Phase 7 — COMPLETE

The reusable complete ordinary lesson-page renderer is implemented and browser-verified at `phase7.html`.

Verified through materially different lesson packages:

- real-shaped `Y5M1` with PreLesson Sheet, ScreenPal video, Homework and protected Answer Pack;
- `DEV-P7-MIN` with all optional resource sections absent;
- `DEV-P7-MANY` with multiple PreLesson Sheets, multiple Homework/Answer Pack pairs and multiple Other Resources;
- `DEV-P7-ENGLISH` through the same ordinary lesson-page renderer;
- locked cross-subject lesson pages show safe metadata/section structure while resources remain inaccessible;
- Year/Level cards and lesson-list rows do not reveal the cross-subject upsell lock prematurely — the first explicit Locked/Preview state is on the individual lesson page;
- shared canonical `Y5M1` displays correctly as `Y5T1M01` in Year 5 and `L2T1M01` in Level 2;
- empty sections disappear entirely;
- Back navigation and Logout remain available;
- raw R2 paths, private URLs and raw ScreenPal IDs are not exposed in student-facing lesson metadata.

Phase 7 uses:

- `phase7.html`
- `assets/phase7.css`
- `assets/phase7.js`
- `assets/phase7-upsell.js`
- `worker/src/index-phase7.js` as the Phase 7 Worker adapter over the completed Phase 6 base Worker.

Detailed verification:

- `docs/data/PHASE7_VERIFICATION.md`
- `docs/data/PHASE7_FIXTURES.md`

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

Phase 7 complete lesson renderer:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase7.html`

## Worker

Worker name:

`fpt-portal-v2-worker`

Worker URL:

`https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

Completed Phase 6 base Worker source:

`worker/src/index.js`

Phase 7 adapter source:

`worker/src/index-phase7.js`

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
- `GET /api/v1/student/lessons/{lessonId}?viewId={viewId}`
- `GET /api/v1/student/resources/{resourceKey}/download?viewId={viewId}`
- `GET /api/v1/student/resources/{resourceKey}/video?viewId={viewId}`
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
- `DEV_LOGIN_ALLOWLIST=test0101,test0202,test0303` during development testing.

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
- `docs/data/PHASE7_VERIFICATION.md`
- `docs/data/PHASE7_FIXTURES.md`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

## Next phase

**Phase 8 — Build Answer Pack and Answer Key Protection.**

Phase 8 must begin in a new chat after reading the latest Master Authoritative Specification, Steps to Progression and cumulative Implementation Handover, then reconnecting to GitHub and inspecting the actual implementation state.