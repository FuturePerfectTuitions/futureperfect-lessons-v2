# Importer source patch V2 trigger

Rerun after correcting the remaining historical regression fixture that encoded Completed + progress Remarks as Ongoing. The source patch remains narrow: prepared-access publication must complete before Portal success, and final Completed status must take precedence over stale progress remarks for each independent parent-email row.
