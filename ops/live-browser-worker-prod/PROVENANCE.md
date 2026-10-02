# Live browser Worker provenance

Production script: `fpt-portal-v2-rebuild-browser-prod`

Recovered read-only from the deployed Cloudflare Worker package on 2026-10-02 before the Year 6 nested-navigation asset repair.

Preserved runtime module SHA-256:

`2257d56c5cd930dacfefa00f310eb5f9bc2db6cd18e3ebf16fb7d8c4ad4c3cbd`

Production bindings observed at recovery:
- `ASSETS`: Workers static-assets binding.
- `STAGING_API`: service binding to `fpt-portal-v2-rebuild-student-prod`, environment `production`.

Production route observed at recovery:
- `lessons.futureperfect.education/*` -> `fpt-portal-v2-rebuild-browser-prod`.

The runtime source is preserved byte-for-byte so frontend asset deployments do not need to reinterpret or replace the edge/API proxy logic.
