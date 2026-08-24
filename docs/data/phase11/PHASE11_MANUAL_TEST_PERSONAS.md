# Phase 11 — manual test personas

Status: **development-only manual acceptance accounts requested by the FPT owner**.

`docs/data/phase11/test_personas.json` is the single authoritative machine-readable source for these accounts. All usernames are case-insensitive because the Worker normalises Portal User IDs. All nine accounts use the test-only login password `Te12` and the test-only Answer Pack password `Te12` so Sej can move quickly through the Phase 11 acceptance matrix. These credentials are for development personas only and must not be reused for real students.

The supplied `Test Y511E` label is normalised to `TestY511E` (no space), matching the naming pattern of the other requested test IDs.

| Login | Intended persona | Batches | Core curriculum entitlement | VR entitlement |
|---|---|---|---|---|
| `TestY2E` | Year 2 English only | `Y2EDEV` | `ENGLISH_Y2` | none |
| `TestY2M` | Year 2 Maths only | `Y2MDEV` | `MATHS_Y2` | none |
| `TestY2EM` | Year 2 English + Maths | `Y2EDEV`, `Y2MDEV` | `ENGLISH_Y2` + `MATHS_Y2` | none |
| `TestY4EM` | Year 4 normal English + Maths | `Y4EDEV`, `Y4MDEV` | `ENGLISH_Y4` + `MATHS_L1` | none |
| `TestY411M` | Year 4 11+ Maths only | `Y4M11DEV` | `MATHS_L2` | none |
| `TestY511E` | Year 5 11+ English only with VR | `Y5E11DEV` | `ENGLISH_Y5` | `ENGLISH_Y5` |
| `TestY5EM` | Year 5 normal English + Maths | `Y5EDEV`, `Y5MDEV` | `ENGLISH_Y5` + `MATHS_L2` | none |
| `TestY5E` | Year 5 normal English only | `Y5EDEV` | `ENGLISH_Y5` | none |
| `TestY511EM` | Year 5 11+ English + Maths with VR | `Y5E11DEV`, `Y5M11DEV` | `ENGLISH_Y5` + `MATHS_L3` | `ENGLISH_Y5` |

## Deterministic entitlement expectations

The Phase 11 apply-package generator derives D1 test entitlements from the canonical catalogue rather than duplicating lesson IDs manually in this document:

- `TestY2E`: 29 core / 0 VR
- `TestY2M`: 36 core / 0 VR
- `TestY2EM`: 65 core / 0 VR
- `TestY4EM`: 70 core / 0 VR
- `TestY411M`: 38 core / 0 VR
- `TestY511E`: 32 core / 32 VR
- `TestY5EM`: 70 core / 0 VR
- `TestY5E`: 32 core / 0 VR
- `TestY511EM`: 75 core / 32 VR

Combined test-persona D1 rows: **447**, of which **64** carry VR access.

## Acceptance purpose

Together these personas allow manual verification of one-subject and two-subject navigation; normal Year versus 11+ Level presentation; cross-subject locked previews; shared canonical Maths Year/Level aliases; normal versus 11+ English presentation; VR visibility; 11+-only ScreenPal quiz visibility; protected Answer Pack password flow; and Year 4/Year 5 11+ Maths current-Level mapping.

The guarded Phase 11 Cloudflare apply may seed these records only into the isolated V2 development `STUDENTS_KV`, add their normalised IDs to `DEV_LOGIN_ALLOWLIST`, and create their test-only D1 entitlements. It must not enable normal production student login and must not touch the existing live portal.
