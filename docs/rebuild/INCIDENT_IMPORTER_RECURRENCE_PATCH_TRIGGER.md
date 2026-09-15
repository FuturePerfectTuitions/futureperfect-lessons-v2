# Importer recurrence patch trigger

Owner-authorized continuation of the 2026-09-15 entitlement incident repair.

This trigger authorizes source/test changes only. It does not authorize a production Worker deployment.

Required semantics:
- validated English 11+ batch definition, not stale profile `vrEligible`, grants VR;
- repeated authoritative imports may upgrade VR 0 -> 1;
- imports must never downgrade previously earned VR 1 -> 0;
- all existing importer/security/navigation regression tests must pass before the source patch is committed.
