# Step 10 Gate D preflight — authorised, awaiting real live session

Date: 2026-09-17

## Authority

Gate D was explicitly authorised by the owner in the active chat on 2026-09-17.

Authorised real account selected from the established project context and freshly verified in production:
- Portal User ID: `Kiaan1312` (normalised `kiaan1312`)
- active batch: `Y511FM`
- subject: `maths`
- stream: `11plus`
- maths level: `3`
- school year: `5`
- assignment effective from: `2026-09-08`
- batch active from: `2026-09-08`
- no effective/active end date.

Verification workflow:
- run `35266652669`
- job `105355396518`
- marker `GATE_D_AUTHORISED_ACCOUNT_L3_ACTIVE_PASS`.

The production D1 query was read-only (`changes: 0`, `changed_db: false`, `rows_written: 0`).

## Session boundary

At preflight time the same authorised account had:
- active Portal sessions: `0`;
- session-profile rows: `1` (not usable as authentication and does not expose a raw session token);
- trial-consumption rows: `0`.

Therefore Gate D must NOT synthesize, recover, bypass, or manufacture a Portal session. The owner must establish a normal real Portal login session for `Kiaan1312` in the browser. No password or cookie may be pasted into chat, GitHub, logs, handovers, or workflows.

## Production state safety

Preflight reconfirmed `quiz_launch_codes` row count remained `0`. No Portal data, entitlements, Worker deployment, frontend deployment, Quiz production data, session token or secret was mutated or exposed by this preflight.

## Gate D state

- Gate D: **AUTHORISED — WAITING FOR REAL LIVE PORTAL SESSION**.
- Gate E: **NOT AUTHORISED**.
- Frontend PR #11 remains blocked.

After the owner establishes the normal browser login session, rerun the account/session preflight before issuing any real launch. Then execute the Gate D cross-domain acceptance requirements from `docs/STEP10_ROLLOUT_SEQUENCE.md` / `STEP10_ACCEPTANCE.md` using only that legitimate session.
