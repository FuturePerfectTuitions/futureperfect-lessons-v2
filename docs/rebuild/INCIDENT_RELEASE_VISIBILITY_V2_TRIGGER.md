# Incident release visibility V2 trigger

Read-only production diagnostic for Kian/Kiaan (`kiaan1312`) and Zara (`zar0603`) after successful importer `GRANT_FULL` results were not reflected in the rebuilt portal. V2 avoids relying on the absent `rebuild_shadow_reconciliation` table and instead identifies prepared access snapshots by the account first name embedded in each prepared snapshot.

No production mutation is authorized by this trigger.
