# Step 10 Gate D boundary — STOP HERE

Date: 2026-09-17

## Current authority

- Gate A — CLOSED PASS.
- Gate B — CLOSED PASS.
- Gate C — CLOSED PASS.
- Gate D — NOT AUTHORISED.
- Gate E — NOT AUTHORISED.

Gate C closeout authority: `authority/STEP10_GATE_C_CLOSEOUT_2026-09-17.md`.

## Do not start Gate D automatically

Gate D is the real cross-domain acceptance stage. It must not begin merely because Gate C passed.

Before Gate D, require both:
1. explicit authority to run Gate D; and
2. the required authorised real L3 Maths 11+ test account/session.

Do not invent a test identity, broaden an existing student's entitlements, create production launch data merely to satisfy the gate, or promote frontend PR #11.

## Final Gate C live anchors

- Backend production main: `55e3c6ed0ffbade0e9449ec53c2412ceb1c8f366`.
- Portal Worker live version: `aed647e8-1798-4271-babc-0147a5c16cf2`.
- Quiz Worker live version: `13eda650-d6b3-4ed3-a3cc-c788306a4789`.
- Quiz hostname: `https://quiz.futureperfect.education`.
- Quiz bridge URL: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`.
- Portal D1 launch-code table/indexes present; final verified row count `0`.
- Portal frontend production main unchanged at `96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7`.
- Frontend PR #11 remains draft and unmerged.

## Rollback references retained

Portal pre-Gate-C deploy rollback:
- Worker version `4ae03435-4b2f-4d7c-aa0e-2804417e862c`.
- D1 bookmark `00000305-00000000-000050e9-eef6c293acdb55b3cd6839ea6d4bc626`.

Quiz pre-correction rollback:
- Worker version `2323b805-2c3f-4059-81a3-cc8d7bb80ad1`.

No rollback was required during Gate C.

## Security note

`QUIZ_BRIDGE_SECRET` remains out of band. Its value must not be requested, printed, retrieved, committed, or added to a handover. Gate C interoperability is already proven by the required HTTP 410 invalid-code handshake.
