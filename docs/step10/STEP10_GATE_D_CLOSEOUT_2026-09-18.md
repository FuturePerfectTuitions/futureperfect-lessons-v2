# Step 10 Gate D — CLOSEOUT

Date: 2026-09-18
Status: **CLOSED — PASS**
Authorised real test identity: `kiaan1312`
Branch: `mastery/step10-gate-d-v2-backend-2026-09-18`
Gate E: **NOT AUTHORISED**

## Acceptance evidence

### Real browser sequence
A real authenticated Portal session for `kiaan1312` completed the Gate D browser sequence and displayed the browser marker:

`STEP10_GATE_D_BROWSER_SEQUENCE_COMPLETE`

Observed browser acceptance results included:
- Portal Home HTTP 200.
- Maths navigation HTTP 200.
- L3 lessons HTTP 200.
- L3 lesson count: 43.
- Representative lesson request HTTP 200.
- Eligibility endpoint HTTP 200 with `eligible: true`.
- A valid one-time cross-domain launch opened `https://quiz.futureperfect.education/app` and rendered the standalone 11+ Practice application.
- The test did not start a Stretch Test or Timed Test.
- The browser sequence completed after the replay/expiry checks and Portal regression checks.

No launch code, session cookie, password, or other secret is recorded in this closeout.

### Server-side postcheck
GitHub Actions run `35326994293` (`Step 10 Gate D real acceptance postcheck`) completed successfully against head SHA `181dad00951ef5ccf000ff41bb9c3af9bfb4a3cc`.

Verified outcomes:
- Production Worker anchors remained unchanged:
  - Student Worker: `f26167b1-073c-4015-912a-288a3d20e0bb`
  - Browser Worker: `f8a64bc8-8192-4400-9e45-8f1a1de10019`
  - Quiz Worker: `13eda650-d6b3-4ed3-a3cc-c788306a4789`
- Portal assignment remained `Y511FM / maths / 11plus / L3`.
- Exactly 2 Gate D launch rows existed for the authorised user.
- Exactly 1 launch was redeemed successfully.
- The redeemed launch was single-use; replay created no extra Quiz authentication session.
- The second launch expired unused and created no Quiz authentication session.
- Exactly 1 Quiz authentication session and 1 `QUIZ_LOGIN_CREATED` audit event existed for the authorised user.
- Zero Quiz test sessions were created.
- Direct unauthenticated Quiz access returned to the Portal.
- A sentinel Portal cookie was ignored by the Quiz origin, confirming cookie isolation.
- Release-context semantics remained valid.

Postcheck artifact:
- Artifact ID: `10539725931`
- Name: `step10-gate-d-real-acceptance-postcheck`
- Digest: `sha256:5f814aa151e484c29e612ff83eb0fd53aa9be5b18a187d4beed7c9319a198ba8`

## Gate D decision
Gate D acceptance criteria are satisfied. Gate D is formally **CLOSED — PASS**.

No Gate E work is authorised by this closeout. Do not deploy, mutate production, or advance into Gate E without fresh explicit authorisation.
