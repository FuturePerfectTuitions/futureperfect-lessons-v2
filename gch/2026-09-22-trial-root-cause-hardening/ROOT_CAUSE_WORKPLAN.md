# Root-cause workplan — next continuation

The next continuation should not begin by changing `TrialEva` or adding another special case. Start by proving the current production graph and source lineage.

The architecture target should make Trial creation a **transactional provisioning contract at the application level**: Admin success means credentials exist, one-login state is correct, selected views resolve against the current catalogue, prepared Student access has been published, and the published model has been read back and verified. A failure in any downstream projection must fail the Admin operation visibly and compensate/rollback where safe rather than leaving a half-created Trial.

The highest-risk architectural smell is that Trial access has accumulated multiple mechanisms: canonical `trialViews`, prepared access publication, and runtime overlay logic. The continuation must decide which mechanism is authoritative for normal serving and reduce the others to explicit compatibility/fallback roles or remove them after migration. The v4.2 authority states that the Student-serving store is `READ_MODELS_KV`; that should be the starting presumption unless fresh evidence proves the architecture has changed.

The frontend must be treated as a separate deployable surface. The currently deployed friendly exhausted-Trial UX comes from `futureperfect-lessons-test@d7a416c2e13af7bab092efdb7694bde03ff7e245`, while that repository's main is older. Before another Browser deployment, promote or otherwise pin the accepted frontend lineage so deployment cannot accidentally build an older branch and remove user-facing capabilities again.

Acceptance must be generic. Use a disposable Trial account created through the real Admin API with a generated unique ID, test representative resources and protected answers, verify second login is rejected as `TRIAL_ACCESS_ENDED`, verify the Browser displays the approved upsell message, then delete the account. In addition, use table-driven tests to exercise every selectable Trial view and the Year 4/Year 5 11+ English + VR combinations.

No production mutation is authorised by this handover. The next continuation may perform read-only audits and off-production test/design work autonomously; production writes/deploys require fresh explicit authorisation after the root-fix candidate and preservation evidence are complete.
