# Phase 17 — Pre-Launch Freeze and Production Verification

Status: **OPEN — verification in progress**

Phase 17 starts from the formally closed Phase 16 main checkpoint `05f9c23bdb3e599ef0c641490822e9d63e5728fe`.

## Freeze boundary

- Architecture and discretionary UI work are frozen.
- Only a genuine launch-blocking defect may receive the smallest coherent correction, with full regression evidence before refreezing.
- Normal V2 student login remains disabled.
- No DNS, CNAME, production route or domain switch is authorised.
- The existing live portal remains intact as rollback.
- The first real teaching-day `SyncPortalEntitlements` run is not a Phase 17 launch action.
- The old system is not dismantled.

## Initial verification path

The first Phase 17 mutation is repository-only: a guarded read-only audit workflow and audit script. The audit inspects the deployed isolated V2 state without writing to Cloudflare data stores. It verifies the locked catalogue, Worker isolation/bindings, D1 integrity, real configuration shape without exposing identities or passwords, exact launch resource presence, ScreenPal/quiz references and launch-inappropriate fixture counts.

Phase 15 and Phase 16 acceptance evidence is credited rather than destructively repeated. No Phase 18 action is permitted until Phase 17 is explicitly closed.
