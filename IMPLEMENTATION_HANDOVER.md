# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 1.0  
**Updated:** 20 August 2026  
**Completed through:** Phase 1 — Isolated V2 Development Environment

## Authority

Use this file together with:

1. `FPT Portal V2 Master Authoritative Specification` — business/workflow authority.
2. `FPT Portal V2 — Steps to Progression` — build-sequence authority.
3. This file — actual implementation state.

If implementation differs from an older plan, this file records what has actually been built. Business-rule changes must still be reflected in the Master Specification.

## Phase 1 status

**COMPLETE.**

The following full chain has been proven from the public development frontend:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

The `/api/health` response returned `HTTP 200`, `infrastructureHealthy: true`, and each backend binding returned `bound: true` and `ok: true`.

Student login remains disabled.

## GitHub

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development frontend: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- No production `CNAME` is configured.
- Existing live portal repository remains separate and untouched.

### Important repo files currently present

- `index.html` — Phase 1 development status page.
- `assets/styles.css` — initial FPT visual shell.
- `assets/app.js` — Worker connectivity/health tester.
- `config.js` — V2 Worker base URL configuration.
- `worker/src/index.js` — current V2 Worker source.
- `worker/wrangler.toml` — Worker configuration starter.
- `.nojekyll`
- `README.md`
- `IMPLEMENTATION_HANDOVER.md`

## Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Worker URL: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- Current health route: `GET /api/health`
- Environment: `development`
- Student login enabled: `false`

### Environment variables

- `ENVIRONMENT = development`
- `ALLOWED_ORIGINS = https://futureperfecttuitions.github.io`

These are configuration values, not secrets.

## Cloudflare bindings

| Worker binding | Cloudflare resource | Purpose |
|---|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` | Manually maintained student/configuration records |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` | Manually maintained lesson catalogue |
| `DB` | `fpt_portal_v2_db` | Automated Student + Lesson entitlements from Excel |
| `MATERIALS_R2` | `fpt-materials-dev` | Development PreLesson/Homework/Answer/resource files |

## D1

- Database name: `fpt_portal_v2_db`
- Database ID visible at creation: `97250a54-fa91-45ad-a002-3c4566b1fc38`
- Tables at end of Phase 1: `0`
- Phase 1 health test executes `SELECT 1 AS ok` successfully.

No production entitlement tables have yet been created. That belongs to Phase 2.

## KV state

### `FPT_PORTAL_V2_STUDENTS`

- Created specifically for V2.
- Bound to Worker as `STUDENTS_KV`.
- Intentionally empty at end of Phase 1.

### `FPT_PORTAL_V2_LESSONS`

- Created specifically for V2.
- Bound to Worker as `LESSONS_KV`.
- Intentionally empty at end of Phase 1.

## R2 state

- Existing development bucket reused: `fpt-materials-dev`.
- Bound to Worker as `MATERIALS_R2`.
- No new production bucket was created in Phase 1.
- Phase 1 health test successfully lists the bucket.

## Current Worker behaviour

`worker/src/index.js` currently:

- returns JSON with `Cache-Control: no-store`;
- allows the approved GitHub Pages development origin;
- responds to CORS preflight;
- exposes `GET /api/health`;
- verifies that `STUDENTS_KV` can be listed;
- verifies that `LESSONS_KV` can be listed;
- verifies that D1 can execute `SELECT 1`;
- verifies that `MATERIALS_R2` can be listed;
- returns `501 NOT_IMPLEMENTED` for other `/api/*` routes;
- does not implement student login, entitlements or resource delivery yet.

## Phase 1 verified result

Observed from the GitHub Pages development site:

```json
{
  "ok": true,
  "service": "fpt-portal-v2-worker",
  "environment": "development",
  "studentLoginEnabled": false,
  "infrastructureHealthy": true,
  "bindings": {
    "studentsKv": { "bound": true, "ok": true },
    "lessonsKv": { "bound": true, "ok": true },
    "d1": { "bound": true, "ok": true },
    "materialsR2": { "bound": true, "ok": true }
  }
}
```

## Deliberate non-actions in Phase 1

- No live-domain switch.
- No `CNAME` on V2.
- No changes to the existing live site/Worker/KVs.
- No real students added.
- No lesson catalogue loaded.
- No D1 entitlement table yet.
- No Answer Pack security implementation yet.
- No Excel integration yet.
- No Admin console.
- No student authentication enabled.

## Manual deployment note

At this stage the canonical Worker source is committed in GitHub at `worker/src/index.js`, but deployment to Cloudflare has been performed manually through the Cloudflare code editor. Whenever the Worker source changes, the full current `index.js` should be supplied for manual paste/deploy until/if GitHub-driven Worker deployment is introduced later.

## Next incomplete phase

# Phase 2 — Define and Implement V2 Data Foundations

The next chat/session should begin by reading the Master Specification, Steps to Progression and this handover, then perform Phase 2 only.

Phase 2 should establish:

1. The exact manually maintainable Student KV JSON format.
2. The exact Lesson KV JSON format for Maths, English and optional VR resources.
3. The minimal D1 schema for automated Excel-earned `Student + Lesson` entitlements.
4. One dummy student record and one dummy lesson record.
5. Worker health/data test routes proving the Worker can read those records and query the new D1 table.

Do not mass-load real students or lessons in Phase 2.
