# Incident release visibility diagnostic trigger

Read-only production diagnostic for the 2026-09-16 report that the admin importer showed successful `GRANT_FULL` actions while Kian (`kiaan1312`) and Zara (`zar0603`) still saw newly released lessons as Preview / unavailable in the rebuilt portal.

The workflow must only read production D1 and READ_MODELS_KV, compare entitlement rows with prepared access snapshots, and produce evidence. No production mutation is authorized by this trigger.
