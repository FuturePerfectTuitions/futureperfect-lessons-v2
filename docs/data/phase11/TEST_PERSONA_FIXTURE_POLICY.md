# Phase 11 test-persona fixture policy

`docs/data/phase11/test_personas.json` is the single authoritative test-persona source for the nine FPT-owner requested Phase 11 manual acceptance accounts.

Do not maintain parallel hand-written `worker/fixtures/phase11/user-*.json` copies. The guarded apply package must generate the exact `STUDENTS_KV` values from `test_personas.json`, so account configuration cannot drift between documentation, tests and Cloudflare seeding.
