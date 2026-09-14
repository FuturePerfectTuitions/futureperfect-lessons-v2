# CP12 VR Resource Repair — Production Apply Trigger

Triggered after:
- canonical root-cause confirmation against Phase 11 VR source records;
- isolated repair validation PASS (run 34858107906);
- fresh production topology/rollback preflight PASS (run 34858638921);
- exact live production candidate preview PASS (run 34859008168);
- authority and architecture documents re-read before production mutation;
- validated repair promoted to official CP12 SHA `e38ae4755680311186c9fa239dd3958f3de552ea`.

The guarded workflow must re-verify topology immediately before mutation and may update only the prepared read-model scopes `lesson:Y4E1` and `lesson:Y5E2`. Browser/Student Worker code, routes, bindings, entitlements and source lesson records must remain unchanged. Automatic pointer rollback is required on any post-write verification failure.

CP12 remains open after this trigger until all post-repair and stabilisation gates pass. CP13 remains prohibited.
