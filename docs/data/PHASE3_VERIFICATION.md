# Phase 3 Verification — COMPLETE

Updated: 20 August 2026

## Checkpoint

Phase 3 required one complete real-shaped Maths lesson to work end-to-end from the V2 data model before loading the full catalogue.

Result: **PASSED**.

## Proof lesson

- Lesson ID: `Y5M1`
- Title: `Y5M1 Number and Place Value I`
- Lesson KV key: `lesson:Y5M1`
- View KV key: `view:maths-year5`
- ScreenPal reference: `cOV0omn3XVh`
- Development student: `Test0101`
- Student KV key: `student:test0101`
- D1 entitlement: `test0101 + Y5M1`

## R2 proof resources

Bucket: `fpt-materials-dev`

Exact object keys:

- PreLesson: `maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf`
- Homework: `maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf`
- Answer Pack: `maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf`

Public R2 access remains disabled.

## Backend verification

Route:

`GET /api/dev/phase3`

Verified:

- `ok: true`
- `phase: 3`
- `phase3Healthy: true`
- development student found and active
- Year 5 view found
- Y5M1 D1 entitlement resolved
- PreLesson file available
- Homework file available
- Answer Pack file available
- ScreenPal reference returned

## Student-facing navigation verification

Development page:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`

Verified journey:

`Subjects → Maths → Year 5 → Y5M1`

The lesson list is data-driven from the KV view plus D1 entitlement, not a hard-coded Y5M1-only navigation page.

## Lesson-page verification

Verified components:

1. PreLesson Sheet opens correctly through the Worker from private R2.
2. ScreenPal lesson video embeds correctly using `cOV0omn3XVh`.
3. Homework opens correctly through the Worker from private R2.
4. Answer Pack is marked as protected and requires the student's Answer Pack password.

## Protected Answer Pack verification

Verified manually:

- an incorrect password is rejected with `Incorrect Answer Pack password.`;
- the password show/hide eye works;
- the correct development Answer Pack password is accepted;
- the actual PDF pages render inside a custom PDF.js viewer;
- no normal browser PDF download/print toolbar is displayed;
- the on-screen watermark `Test0101 — Future Perfect Tuitions` is displayed;
- closing and reopening the protected resource returns to the password prompt, so the password is required each time.

## Viewer implementation note

The first development viewer attempt used a browser PDF iframe. Chrome displayed an intermediate PDF/Open surface, which was not acceptable for the intended protected-view experience. It was replaced during Phase 3 with a PDF.js canvas renderer.

The resulting viewer hides ordinary PDF download/print controls, but—as stated in the product specification—web content cannot be made absolutely impossible to copy, screenshot or inspect with advanced browser tools.

## Development-only security limitation

Phase 3 deliberately uses a fixed development student and development-only Worker routes. It proves the lesson/resource architecture, but it is **not** the final authentication/session security model.

Normal student login remains disabled. Production-grade authentication and session enforcement are Phase 4.

## Stop/Go decision

**GO to Phase 4 — Build Secure Student Authentication.**

The Phase 3 architecture is proven sufficiently to proceed without loading the real catalogue yet.