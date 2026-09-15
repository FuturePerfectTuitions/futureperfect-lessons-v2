# D1 Batch Assignment Production Repair Retry Trigger

The first guarded production attempt made no D1 changes because Cloudflare D1 rejected the initial multi-row statement for exceeding its SQL variable limit. Automatic rollback verification confirmed the audited four-row state remained intact and deleted zero rows.

This retry uses the same owner-authorized scope and the same 21 roster-proven missing assignments, but performs variable-safe individual INSERT statements with exact rollback of only rows stamped by this repair run if any postcondition fails.

All original guards remain mandatory: fresh 4-existing/21-missing preflight, no runtime source changes, INSERT-only repair, exact 25-row authoritative postcondition, unchanged public Browser → Student topology/versions, and independent read-only entitlement audits.
