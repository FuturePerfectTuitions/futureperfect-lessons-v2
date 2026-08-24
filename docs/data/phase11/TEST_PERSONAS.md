# Phase 11 — owner entitlement test personas

Status: **LOCKED FOR DEVELOPMENT ACCEPTANCE**

These development-only accounts were requested by the FPT owner so the real Phase 11 catalogue can be checked from several student entitlement combinations before Phase 12 begins.

All nine accounts use the same temporary development credentials:

- login password: `Te12`
- Answer Pack password: `Te12`

Portal User IDs are case-insensitive. The requested `Test Y511E` spelling is normalised to `TestY511E` to match the no-space pattern used by the other test IDs.

| Test ID | Intended current access |
|---|---|
| `TestY2E` | Year 2 English only |
| `TestY2M` | Year 2 Maths only |
| `TestY2EM` | Year 2 English + Maths |
| `TestY4EM` | Year 4 normal English + Maths |
| `TestY411M` | Year 4 11+ Maths only → Level 2 |
| `TestY511E` | Year 5 11+ English only, including VR |
| `TestY5EM` | Year 5 normal English + Maths |
| `TestY5E` | Year 5 normal English only |
| `TestY511EM` | Year 5 11+ English + Maths → English 11+ + Level 3 Maths, including English VR |

The test seed uses ordinary D1 Student + Lesson entitlement rows with development batch codes so the acceptance accounts exercise the normal V2 entitlement path rather than an artificial frontend override. Test-only data is clearly separated from future real-student Phase 12 configuration.

Expected seeded D1 rows across these nine accounts: **447**, of which **64** carry VR access. Existing `test0707` remains the Current/Previous history regression account and is re-anchored to five real canonical Phase 11 lessons when the catalogue is applied.
