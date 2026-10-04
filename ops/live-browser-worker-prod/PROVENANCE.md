# Live browser Worker provenance

Production hostname: `lessons.futureperfect.education`

Production Cloudflare route:
- `lessons.futureperfect.education/*` -> `fpt-portal-v2-rebuild-browser-prod`

Production Browser Worker bindings:
- `ASSETS`: Workers static-assets binding.
- `STAGING_API`: service binding to `fpt-portal-v2-rebuild-student-prod`, environment `production`.

The Browser Worker runtime module was recovered read-only from Cloudflare and is preserved byte-for-byte here so frontend asset deployments do not reinterpret or replace the edge/API proxy logic.

Canonical source module SHA-256:
`2257d56c5cd930dacfefa00f310eb5f9bc2db6cd18e3ebf16fb7d8c4ad4c3cbd`

The deployed bundled `index.js` observed before the 2026-10-04 Year 6 ordering repair had SHA-256:
`975d5193073d52663b8dbbee5ccf0387d589fe00cb42c836c58354848c39b2d8`

## Canonical frontend source

The Browser Worker ASSETS payload must be built from:
- repository: `FuturePerfectTuitions/futureperfect-lessons-test`
- branch: `source/live-v2-current`
- state file: `V2_SOURCE_STATE.json`

The V2 application source on that branch is required to remain byte-for-byte the exact 2026-10-02 accepted frontend source at commit:
`e5e833a9b956a6985bb5a76e7dd056b897b7d76e`

The Year 6 chronological-order repair is intentionally additive and lives in:
`public/assets/year6-display-sequence-fix-v2.js`

It is loaded from `index.html` with an explicit cache-busting query string. This mirrors the last known working September architecture: visible-code DOM sorting plus `MutationObserver`, without changing V2 navigation, dedicated SATS routing, Maths Practice, entitlement semantics, resource behaviour, or backend state.

## Deployment rule

GitHub Pages is not the authoritative live serving path while the Cloudflare Worker route above is active. Production frontend fixes must be deployed to the `ASSETS` binding of `fpt-portal-v2-rebuild-browser-prod` with the runtime module and `STAGING_API` binding preserved.

No rollback/revert is permitted as a recovery method. Fix forward from the current live state.
