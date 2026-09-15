# Guarded importer recurrence production deployment trigger

Owner-authorized continuation of the 2026-09-15 entitlement incident repair.

Authorized mutation: deploy the verified importer recurrence fix to the operational Worker `fpt-portal-v2-worker` only.

Mandatory gates:
- preserve the current live operational binding set and all secret names;
- retain the exact pre-deploy operational Worker version for automatic rollback;
- do not alter `lessons.futureperfect.education -> rebuilt Browser -> rebuilt Student` topology or Browser/Student active versions;
- keep admin importer unauthenticated access denied;
- post-deploy semantic entitlement audit must remain PASS;
- roster-backed entitlement/profile/source-batch VR defect sets must remain empty;
- broad historical `student_batch_assignments` drift remains explicitly deferred and must not be mutated by this deployment.
