# Step 10 Gate E — Browser Worker production promotion trigger

Date: 2026-09-18
Gate: E — explicitly authorised by owner

This commit triggers the guarded production promotion of the approved API-v2 Maths landing-page `11+ Practice` frontend only.

Approved frontend source:
- repository: `FuturePerfectTuitions/futureperfect-lessons-test`
- commit: `c26f03d1b353fcccf46b783656bef3bef1315d6d`

Hard boundaries:
- deploy `fpt-portal-v2-rebuild-browser-prod` only;
- preserve the production route and Browser -> Student service binding;
- do not deploy or mutate the Student Worker or Quiz Worker;
- do not mutate Portal D1, Quiz D1, users, batches, entitlements, or sessions;
- do not use the superseded legacy PR #11/top-bar UI;
- automatic rollback to the exact pre-Gate-E Browser Worker version on post-deploy verification failure.
