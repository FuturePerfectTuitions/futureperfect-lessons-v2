# Importer prepared-access + per-lesson email fix trigger

Apply the exact narrow source patches for: (1) publishing each affected student's prepared access model only after all D1 entitlement writes and before reporting Portal success, and (2) making final Completed status authoritative over historical progress remarks for parent-email classification. Run the full importer/email regression suite and commit only if all gates pass.
