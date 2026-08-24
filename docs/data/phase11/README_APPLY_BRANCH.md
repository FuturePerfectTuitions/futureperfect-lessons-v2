# Phase 11 final catalogue implementation branch

This branch packages the real Phase 11 catalogue and verification machinery. It is intentionally non-operative until merged and followed by the separate guarded trigger-only apply PR.

Key invariants before the apply trigger:

- `worker/wrangler.toml` remains on `src/index-phase10-history.js`;
- `phase10.html` remains unchanged and does not load Phase 11 assets;
- `phase11.html` is the isolated Phase 11 proof page;
- no Cloudflare write occurs from this implementation PR;
- normal student login remains disabled;
- the existing live portal is not targeted;
- Phase 12 is not started.
