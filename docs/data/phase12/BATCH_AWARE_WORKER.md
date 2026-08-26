# Phase 12 batch-aware Worker

This change activates the Phase 12 batch-configuration schema at runtime without introducing any real roster or batch data into the public repository.

## Runtime boundary

- Exact operational batch keys live in the isolated development D1 `batch_definitions` table and are never interpreted by parsing their text.
- `student_batch_assignments` is effective-dated and many-to-many.
- The highest active year/level in each subject is presented as Current; other visible years/levels remain Previous.
- A batch assignment changes navigation/configuration only. It does not create, delete or rewrite permanent Student + Lesson entitlements.
- Existing Phase 11 protected-answer, single-device, two-hour inactivity, special-area, quota-safe navigation and presentation rules remain underneath the Phase 12 wrapper.
- English normal and English 11+ share the ordinary lesson video. Maths 11+ uses an interactive ScreenPal quiz in the Lesson Video slot only when an embeddable quiz exists; otherwise the ordinary video remains.
- Normal student login remains disabled in development. The runtime deployment preserves the existing development allowlist rather than storing real IDs in this repository.

## Current data state

At this checkpoint no September operational batch names or assignments have been supplied, so the Phase 12 batch tables remain empty after guarded acceptance. The deployment workflow uses only temporary controlled TestY acceptance rows and deletes them before it can succeed.
