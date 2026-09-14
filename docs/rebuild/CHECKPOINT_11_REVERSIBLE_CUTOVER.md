# Checkpoint 11 — Reversible Cutover

**Status: CLOSED — PASS**

Date: 2026-09-14
Official rebuild branch: `rebuild/portal-v2-performance-2026-09-13`

## Closure evidence

- Exact successful cutover implementation SHA: `dd5c222dfc1f82993de0379b77f42f8bbab8e71f`.
- Exact implementation validation run: `34823823484` — PASS.
- Exact reversible-cutover execution run: `34823892175` — PASS.
- Execution evidence artifact: `10339710520` (`checkpoint11-reversible-cutover-execution-evidence`).
- Rollback rehearsal PASSed before public switching.
- Public route/DNS cutover PASSed.
- Production-shaped authenticated smoke PASSed after cutover, including the approved 8-hour signed session cookie, ordinary resource capability delivery, live Answer Pack password check, maximum 5-minute Answer Pack capability, and lazy video/provider contact only after View.
- Public VR How-To smoke PASSed with the approved manual-only entitlement semantics preserved.
- Post-cutover full live parity PASSed: 372 lessons, zero resource mismatch, zero unexplained student access difference.
- VR How-To special-area audit PASSed with `manual=3`, `direct=0`, supported runtime and catalogue revision in sync.
- Final authoritative Cloudflare topology verification PASSed.
- Emergency rollback was not required because all post-switch gates passed.

## Read-only closure conversion

After the successful cutover, the mutating CP11 workflow was replaced by a read-only closure gate at SHA `e47ca171fb8ea17146ffc7466683b0e3c99999ab` before official-branch promotion.

The closure gate:

- contains no CP11 backfill, special backfill, public cutover, rollback, Wrangler deploy or secret-write path;
- recovers and verifies the exact successful execution evidence;
- re-runs read-only live parity and VR How-To special-area checks;
- independently verifies authoritative Cloudflare DNS/Worker-route topology and direct TLS edge behaviour; and
- verifies the legacy Worker deployment/version and legacy frontend main SHA remain intact as rollback anchors.

Read-only closure validation on the CP11 branch: run `34824505083` — PASS.
Read-only closure validation after official-branch promotion: run `34824632015` — PASS.

## Preserved invariants

All approved authentication, capability, resource, protected-view, lazy-video, bounded-failure and parity invariants remain in force. VR How-To remains manual-only. Legacy Worker/frontend and compatibility/source paths remain retained for Checkpoint 12 stabilisation.

## Next checkpoint

Proceed to **Checkpoint 12 — Stabilisation Period**. Per the approved implementation plan, CP12 cannot close until there is sustained clean operation through representative operational cycles, including normal release/import activity; legacy source/data paths and compatibility writes must remain in place throughout that initial stability window.
