# Phase 12 — Batch Configuration Foundation

This Phase 12 foundation is deliberately data-free in the public repository. Real student identifiers, passwords, entitlement histories and real batch assignments must not be committed here.

## Authoritative batch identity

- `batch_key` is the exact academic-year batch name used by the owner and by Excel Column C.
- Do not derive, shorten, uppercase, lowercase or otherwise rewrite a batch key.
- A batch is configured explicitly with subject, school year, stream and (for 11+ Maths) Maths level.
- Current navigation must use explicit batch configuration rather than guessing from a batch-name prefix.

## Assignment dates

- `effective_from` is inclusive.
- `effective_to` is exclusive.
- A student may have multiple active batch assignments at the same time, including multiple batches in the same subject at different years/levels.
- A transfer ends the old assignment from the transfer date and starts the new assignment from that date.
- Removing a student from a batch stops future releases only; it does not revoke already-earned Student + Lesson entitlements.

## No retroactive grants

Creating a batch or assigning a student to a batch must never insert lesson-entitlement rows by itself. Student + Lesson entitlement remains permanent and is granted only when an eligible lesson release occurs (or through an explicit individual/manual entitlement action).

For a batch lesson released on date `D`, the student is eligible through that batch only when:

`effective_from <= D` and (`effective_to` is null or `D < effective_to`).

This preserves mid-term joining, batch transfer, absence, guest attendance and retained-entitlement rules.

## Batch + Lesson operational mapping

`batch_lesson_releases` records the operational Batch + Lesson relationship. Duplicate completion/release processing is harmless because `(batch_key, lesson_id)` is unique. `source_row_id` is available for the Excel Sync Row ID audit value; it is not a student identifier.

## Phase 12 staging

1. Real student records and explicitly supplied historical/permanent entitlements can be configured in the isolated development environment.
2. September batch definitions and assignments are added only after the owner supplies the exact real Column C batch names and assignment facts.
3. Normal real-student login remains disabled until the deliberate final live switch. Temporary owner acceptance allowlisting is development-only.
4. The existing TestY acceptance fixtures remain available as controlled test accounts.

## Security boundary

This schema is for the isolated V2 development D1 database. It does not change the live/production portal, DNS, CNAME, R2 catalogue content, lesson catalogue contents, protected-answer rules or production login state.
