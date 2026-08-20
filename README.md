# Future Perfect Tuitions — Student Portal V2

Isolated development repository for the next-generation Future Perfect Tuitions student portal.

## Phase 1 status

- V2 repository created separately from the live portal.
- Static development landing page added.
- FPT visual shell started using the existing navy/red/white design language.
- Frontend Worker connectivity tester added.
- Minimal Worker source added at `worker/src/index.js` with `GET /api/health`.
- `worker/wrangler.toml` added with the approved GitHub Pages development origin.
- No live custom domain / `CNAME` is configured.
- No student login is implemented or enabled.
- KV, D1 and R2 bindings will be added only after the separate V2 Cloudflare resources are created.

## Development URL

Once GitHub Pages is enabled from the `main` branch / repository root, the expected development URL is:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`

## Worker

The intended development Worker name is:

`fpt-portal-v2-worker`

After the Worker is deployed, add its HTTPS base URL to `config.js`:

```js
window.FPT_V2_CONFIG = Object.freeze({
  environment: "development",
  workerBaseUrl: "https://YOUR-V2-WORKER.workers.dev"
});
```

Then the development page can test `GET /api/health`.

## Safety rule

The existing live portal, existing Worker and existing KV namespaces must remain untouched while V2 is being built and tested.
