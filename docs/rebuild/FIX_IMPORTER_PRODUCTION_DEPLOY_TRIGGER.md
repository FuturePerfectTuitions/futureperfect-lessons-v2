# Importer prepared-access and per-lesson email production deploy

Authorized production deployment after the complete source regression suite passed. The deployment must preserve all live operational Worker bindings, preserve the public Browser -> Student topology and versions, retain the current operational Worker version for rollback, prove zero all-student D1-to-prepared-access mismatches before and after deployment, and automatically roll back on any failed post-deploy gate. No parent email or synthetic production entitlement may be created by this deployment verification.
