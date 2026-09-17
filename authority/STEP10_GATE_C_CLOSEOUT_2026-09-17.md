# Step 10 Gate C closeout — CLOSED PASS

Date: 2026-09-17

## Decision

**Gate C — CLOSED PASS.**

Gate C completed the hidden production Portal backend bridge rollout without deploying the Portal frontend or starting Gate D.

## Final live state

- Backend main merge commit: `55e3c6ed0ffbade0e9449ec53c2412ceb1c8f366` (PR #195 merged).
- Production Portal Worker: `fpt-portal-v2-worker`.
- Final Portal Worker version: `aed647e8-1798-4271-babc-0147a5c16cf2` at 100% traffic.
- Portal D1: `fpt_portal_v2_db`, binding `DB`, ID `97250a54-fa91-45ad-a002-3c4566b1fc38`.
- `quiz_launch_codes` table and both required indexes remain present.
- Final verified launch-code row count: `0`.
- Standalone Quiz Worker: `futureperfect-11plus-practice-step10-preview`.
- Final Quiz Worker version: `13eda650-d6b3-4ed3-a3cc-c788306a4789` at 100% traffic.
- Quiz D1 ID: `5b988d3d-341a-492d-8e40-8d4efa66150e`.
- Quiz custom hostname: `https://quiz.futureperfect.education`.
- Final Quiz `PORTAL_BRIDGE_URL`: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`.
- `QUIZ_BRIDGE_SECRET` remains configured on both Workers; the value was never requested, printed, retrieved, committed, or recorded.
- Production frontend main remains `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`; frontend PR #11 remains draft and unmerged.

## Rollback anchors

Fresh anchors were captured/reconciled before the production Portal deploy because the handover Worker version had changed after the original capture.

Portal pre-deploy rollback anchors:
- Worker version: `4ae03435-4b2f-4d7c-aa0e-2804417e862c`.
- D1 Time Travel bookmark: `00000305-00000000-000050e9-eef6c293acdb55b3cd6839ea6d4bc626`.

The prior Worker version `b590516b-8258-49e1-81e4-38f89979523b` was compared with `4ae03435-4b2f-4d7c-aa0e-2804417e862c`; script content and non-secret bindings were identical, with the expected `QUIZ_BRIDGE_SECRET` binding present on the newer version.

Quiz correction rollback anchor:
- Quiz Worker version before URL correction: `2323b805-2c3f-4059-81a3-cc8d7bb80ad1`.

No rollback was required.

## Guarded Portal promotion

PR #195 was marked ready and merged only after fresh GitHub/Cloudflare verification.

Guarded production Gate C workflow run: `35264212040`.

The workflow:
- passed prerequisites;
- deployed only the reviewed hidden bridge using the dedicated `WORKER_ENTRYPOINT` override;
- preserved production bindings/secrets;
- passed established Admin/protected-answer regressions;
- deployed Portal Worker version `aed647e8-1798-4271-babc-0147a5c16cf2`.

Its final Quiz-to-Portal handshake check initially failed. Promotion stopped there; Gate D was not started.

## Failure diagnosis and correction

Read-only diagnostic run: `35264381281`.

It proved:
- unauthenticated eligibility route -> HTTP 401 / fail closed;
- unauthenticated launch route -> HTTP 401 / fail closed;
- unauthenticated direct redeem route -> HTTP 401 / fail closed;
- the bridge endpoint on the direct Portal Worker URL was healthy;
- `https://lessons.futureperfect.education/api/v1/quiz-bridge/redeem` was not routed to the Portal Worker and returned HTTP 404.

Therefore the failure was routing/configuration, not evidence of a mismatched shared secret.

The Quiz Worker bridge URL was corrected to the direct production Portal Worker URL without changing the secret, D1 database, custom-domain trigger, or reviewed Quiz source.

The production correction used Cloudflare Worker Versions from an isolated backend ops branch because the standalone repository did not have Cloudflare Actions credentials. Before upload, the staged Quiz files were proven byte-identical to the reviewed standalone PR source using these Git blob IDs:
- `src/index.js`: `e7a5c0fb704d17eddf108f817cf5f3df89f496ff`
- `src/remediation.js`: `030692e4c0d6a318dcf3bdded5750234e39c271c`
- `src/selector.js`: `2082299d1bc513a5076bc1f9c7f1d06b653d235d`

Quiz correction run: `35265111922` — SUCCESS.

Candidate/final Quiz version: `13eda650-d6b3-4ed3-a3cc-c788306a4789`.

The candidate was inspected before promotion and confirmed to preserve:
- Quiz D1 binding `5b988d3d-341a-492d-8e40-8d4efa66150e`;
- `QUIZ_BRIDGE_SECRET` secret binding;
- expected direct `PORTAL_BRIDGE_URL`.

Promotion used Worker Versions at 100%; no trigger deployment was performed. The custom hostname remained healthy.

## Final acceptance evidence

Final consolidated Gate C acceptance run: `35265440570`.
Final acceptance job: `105351330581`.
Result: **SUCCESS** with marker `STEP10_GATE_C_FINAL_ACCEPTANCE_PASS`.

The final sweep proved:
- Portal and Quiz Worker identities/bindings are correct;
- both expected final Worker versions are at 100% traffic;
- `QUIZ_BRIDGE_SECRET` exists on both Workers without exposing its value;
- existing Admin route remains fail-closed unauthenticated;
- protected Answer viewer invalid-token route remains HTTP 410 with the established stability header;
- unauthenticated eligibility/launch/redeem routes fail closed exactly as required;
- `https://quiz.futureperfect.education/launch?code=<invalid>` returns HTTP 410 and the expected invalid-link page, proving the Quiz Worker can authenticate to the Portal bridge;
- Quiz `/health` remains HTTP 200;
- Portal `quiz_launch_codes` row count is `0` before and after the invalid-code handshake;
- final D1 verification reported `changes: 0`, `changed_db: false`, and `rows_written: 0`;
- no unrelated Portal data/entitlement mutation was made by Gate C.

## Frontend boundary

No production frontend promotion occurred in Gate C.

- Production frontend main: `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`.
- Frontend PR #11: OPEN / DRAFT / UNMERGED.

## Gate boundary

Gate D is **NOT AUTHORISED** by this closeout.
Gate E/frontend promotion is **NOT AUTHORISED**.

The next session must stop at the Gate D boundary unless explicit authority to run Gate D exists and the required authorised real L3 test account/session is available.
