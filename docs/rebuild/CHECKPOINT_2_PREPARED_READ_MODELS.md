# Portal V2 Performance Rebuild — Checkpoint 2

## Prepared Read Models

Baseline production backend source: `e4c7bde7ad9a9402136da5798d7ab690ab30322c`.

Checkpoint 2 replaces request-time reconstruction with deterministic prepared read-model primitives while keeping production unchanged. It does not introduce the future session/cookie model, resource capabilities, Answer Pack redesign, frontend cutover, production data migration, or production route changes.

## Catalogue read model

The catalogue compiler produces three metadata-only structures from the authoritative lesson catalogue input:

1. a compact global navigation list;
2. a compact per-Year/Level catalogue for each supported view;
3. a reverse immutable Lesson ID → view index for access compilation.

The compiler deliberately retains only `lessonId`, student-facing display ID, title, description and order. R2 keys, resource URLs, video URLs, passwords, tokens, cookies and email data are forbidden.

The staging workflow reads the current production `LESSONS_KV` **read-only**, compiles the metadata-only model during the build, and bundles the prepared result into the isolated Student staging Worker. The staging Worker has no production KV, D1, R2 or email binding, so serving prepared navigation requires no runtime data-store query.

The historical Phase 11 count of 369 lessons is not used as a Checkpoint 2 authority. The workflow discovers the current lesson set from the live curriculum records and records the resulting count and model SHA-256.

## Stable view registry

The prepared model has the existing 15 student views:

- Maths Year 2–Year 6;
- Maths L1–L3;
- English Year 2–Year 6;
- English Year 4 11+ and Year 5 11+.

There are no Year 2 or Year 3 11+ views.

## Access snapshot compiler

`rebuild/shared/read-models/access-snapshot.mjs` is a pure deterministic compiler. It accepts already-read authoritative inputs and produces a password-free prepared access snapshot. It does not query D1/KV itself.

The model represents:

- multiple simultaneously Current views, including same-subject views;
- effective-dated Current/Previous history;
- persisted earned Lesson ID access;
- Full Library access as an independent access source;
- manual individual lesson access as an independent source;
- online PreLesson-only access;
- temporary/guest lesson access input;
- blocked-lesson override;
- configured locked upsell views or the legacy automatic counterpart preview rule;
- special-area authorisation such as VR How-To;
- separate core and VR access state.

Ambiguous shared curricula do not widen access. In particular, manual access to a lesson shared by an ordinary Maths Year view and an 11+ Level view surfaces the ordinary historical Year view only, matching the accepted legacy presentation rule. Earned/prelesson access can use its source batch definition to resolve the exact view.

## Checkpoint 2 acceptance gate

Checkpoint 2 passes only when all of the following are evidenced:

- deterministic read-model regression tests pass;
- metadata-only catalogue sanitisation passes;
- sensitive-field access-snapshot sanitisation passes;
- the current production LESSONS_KV namespace is confirmed before preparation;
- all required live curriculum records are present and non-empty;
- the live metadata is compiled into 15 prepared views without hard-coding an obsolete lesson count;
- Student staging deploys from the generated prepared catalogue;
- staging `/health`, `/read-models/status` and `/read-models/navigation` prove the prepared model is active;
- Student staging still has no KV/D1/R2/email binding or custom production route;
- production Worker deployment and version remain exactly the Checkpoint 0 anchor before and after the staging deployment.

## Explicit non-goals

Checkpoint 2 does **not** create real student access snapshots, copy student records to staging, read `STUDENTS_KV`, alter D1, alter R2, change email configuration, change production authentication, or repoint `lessons.futureperfect.education`.
