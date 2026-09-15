# Incident importer exact-version reactivation trigger

Triggered after the first guarded production deploy correctly auto-rolled back because the roster audit returned a generic non-zero exit for the already-known, explicitly deferred D1 batch-assignment drift.

This trigger authorizes reactivation of the exact previously built and binding-verified Worker version `2eec1f4d-daec-4d40-be55-b779852ddfb2` only. The workflow must preserve the public Browser -> Student topology, preserve the operational Worker binding set, reject any critical entitlement/profile/source-batch defects, tolerate only pre-existing/decreasing D1 assignment drift, and automatically restore the preflight active operational Worker version on any verification failure.
