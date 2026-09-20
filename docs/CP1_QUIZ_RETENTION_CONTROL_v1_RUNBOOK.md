# CP1 Quiz student-data retention control v1.0

**Authority:** FPT 11+ Maths Mastery Master Specification v1.3 (20 September 2026).

Student-linked Quiz history remains continuous across L2 -> L3 for the same Portal user. Retention deletion is due only on **10 September following completion of that student's L3 Quiz year**. Anonymous item-quality analytics may remain.

This control is intentionally manual (`workflow_dispatch`) and has no cron or push trigger. The operational workflow lives in the Portal/operations repository because that repository holds the authorised Cloudflare operations credentials; it targets only the pinned Quiz D1 and verifies the Quiz Worker DB binding before proceeding.

## Annual Phase A — dry-run

Prepare an owner-reviewed private manifest in repository secret `RETENTION_TARGET_MANIFEST_JSON`:

```json
{"authorityVersion":"v1.3","cohortLabel":"2026-27-L3","retentionDate":"2027-09-10","portalUserIds":["..."]}
```

The cohort must come from authoritative student/cohort records. Never infer who is due for deletion from username format, current lesson-progress output, question exposure, or present level alone.

Run `CP1 Quiz annual student-data retention v1` with `mode=dry-run`. It checks exact D1 identity, Quiz Worker DB binding, required schema, Time Travel bookmark, target counts, active non-abandoned sessions, anonymous `question_aggregate` hash, 714 LIVE / 91-family baseline, and foreign keys. Dry-run performs zero DELETE/UPDATE/INSERT operations and writes only de-identified evidence: target count + manifest SHA, not student IDs.

## Annual Phase B — apply requires a separate owner approval

The current CP1 implementation approval does **not** authorise apply. Apply must not be selected until the owner separately approves the purge after reviewing the dry-run evidence.

Apply fails closed unless: it is the exact UTC 10 September retention date; authority remains v1.3; production D1 UUID is unchanged; the manifest SHA matches the reviewed dry-run; the current Time Travel bookmark exactly matches the reviewed bookmark; the referenced dry-run artifact remains available; the maintenance/no-concurrent-write condition is confirmed; and the typed phrase exactly equals `PURGE QUIZ STUDENT DATA <cohort_label> ON <retention_date>`.

The deletion batch targets only student-linked tables: `quiz_auth_session`, `quiz_generation_lock`, `quiz_audit_event`, `quiz_recommendation`, `student_skill_profile`, `attempt`, `exposure_history`, then `quiz_session`; session children are removed through existing FK cascades. `question_aggregate` is never in the deletion set.

Post-apply acceptance requires zero target rows, zero cascade-child rows, zero FK violations, an unchanged anonymous aggregate hash, and unchanged 714 LIVE / 91-family bank baselines. Any authority, D1, schema, bank-baseline or retention-policy change requires re-review before use.
