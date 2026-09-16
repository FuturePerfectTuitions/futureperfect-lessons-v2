# Incident broad release visibility audit trigger

Read-only audit of every lesson entitlement confirmed in production D1 on 2026-09-16, compared with each student's currently published prepared access snapshot. Also records whether the retained importer Worker has a READ_MODELS_KV binding or an AdminOps service binding.

No production mutation is authorized by this trigger.

Post-repair rerun: independently require the nine previously stale grants to be visible from the prepared access layer.
