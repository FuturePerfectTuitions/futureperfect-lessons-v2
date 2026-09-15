# Incident entitlement production repair trigger

Authorized by owner on 2026-09-15 after independent diagnosis of the Dha2806 / Rei0710 English 11+ VR entitlement defect and stale Y4E1 PreLesson resource.

Write scope is intentionally limited to:
- lesson_entitlements: Dha2806/Y4E1 and Rei0710/Y4E1, monotonic repair from vr_access=0 to 1 only when exact source-batch guards match;
- STUDENTS_KV profiles: vrEligible false -> true for those two users only;
- LESSONS_KV lesson:Y4E1: remove only the exact stale core PreLesson item `Y4T1E01 PreLesson Sheet Transitioning from Year 3 to Year 4.pdf`;
- canonical prepared-model republish from authoritative sources.

No batch-assignment bulk repair, Browser/Student deployment, route mutation, security weakening, or unrelated resource change is authorized by this trigger.
