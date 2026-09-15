# D1 Batch Assignment Production Repair Trigger

Authorized by the owner on 2026-09-15 after the completed read-only reconciliation.

Scope is strictly limited to the 21 roster-proven missing `student_batch_assignments` rows identified by the closed read-only audit.

Required guards:

- exact audit closure ancestry;
- no runtime Worker/frontend source changes;
- abort on any precondition drift from the audited 4-existing / 21-missing state;
- INSERT only, with no UPDATE and no DELETE except an exact automatic rollback of rows inserted by this repair if postconditions fail;
- exact postcondition of 25 authoritative memberships, zero extras, zero date/window mismatches;
- rebuilt Student remains independent of `student_batch_assignments`;
- public Browser → Student topology and active Worker versions remain unchanged;
- rerun independent roster-backed entitlement and semantic audits read-only;
- retain safe evidence and exact rollback SQL.
