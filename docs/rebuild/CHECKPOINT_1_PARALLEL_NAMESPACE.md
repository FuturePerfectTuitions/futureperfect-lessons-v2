# Portal V2 Performance Rebuild — Checkpoint 1

## Parallel rebuild namespace

Baseline source SHA: `e4c7bde7ad9a9402136da5798d7ab690ab30322c`.

This checkpoint establishes isolated non-production deployment identities only. It does not implement Checkpoint 2 read models, does not repoint production routes, and does not bind production KV, D1, R2 or email resources.

### Student Runtime

- development identity: `fpt-portal-v2-rebuild-student-dev`
- staging identity: `fpt-portal-v2-rebuild-student-staging`
- source: `rebuild/student/src/index.js`
- config: `rebuild/student/wrangler.toml`

### Admin/Operations Runtime

- development identity: `fpt-portal-v2-rebuild-adminops-dev`
- staging identity: `fpt-portal-v2-rebuild-adminops-staging`
- source: `rebuild/adminops/src/index.js`
- config: `rebuild/adminops/wrangler.toml`

Both staging runtimes expose only `GET /health` at Checkpoint 1. All other routes return 404. They have no data-store or email bindings and no custom routes.

## Production isolation rule

The production Worker identity `fpt-portal-v2-worker` is not a deployment target in either rebuild config. The checkpoint deployment workflow verifies the exact production deployment/version from Checkpoint 0 before and after staging deployment.

## Gate

Checkpoint 1 passes only when both staging Workers deploy independently, both `/health` endpoints return their expected runtime/environment identity, and the production Worker remains on the Checkpoint 0 backend deployment/version.
