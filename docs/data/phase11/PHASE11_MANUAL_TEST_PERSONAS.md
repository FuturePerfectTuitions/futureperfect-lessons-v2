# Phase 11 — manual test personas

Status: development-only manual acceptance accounts requested by the FPT owner.

All usernames are case-insensitive because the Worker normalises Portal User IDs. All nine accounts use the test-only login password `Te12` and the test-only Answer Pack password `Te12` so Sej can move quickly through the acceptance matrix. These credentials are for development personas only and must not be reused for real students.

The supplied `Test Y511E` label is normalised to `TestY511E` (no space), matching the naming pattern of the other requested test IDs.

| Login | Intended persona | Batches | VR | Full-library continuity |
|---|---|---|---:|---|
| `TestY2E` | Year 2 English only | `Y2EDEV1` | No | none |
| `TestY2M` | Year 2 Maths only | `Y2MDEV1` | No | none |
| `TestY2EM` | Year 2 English + Maths | `Y2EDEV1`, `Y2MDEV1` | No | none |
| `TestY4EM` | Year 4 normal English + Maths | `Y4EDEV1`, `Y4MDEV1` | No | none |
| `TestY411M` | Year 4 11+ Maths | `Y4M11DEV1` | No | `MATHS_L1_FULL` |
| `TestY511E` | Year 5 11+ English with VR | `Y5E11DEV1` | Yes | none |
| `TestY5EM` | Year 5 normal English + Maths | `Y5EDEV1`, `Y5MDEV1` | No | none |
| `TestY5E` | Year 5 normal English only | `Y5EDEV1` | No | none |
| `TestY511EM` | Year 5 11+ English + Maths with VR | `Y5E11DEV1`, `Y5M11DEV1` | Yes | `MATHS_L2_FULL` |

## Acceptance purpose

These personas are deliberately complementary. Together they allow manual checking of:

- one-subject and two-subject navigation;
- normal Year presentation versus 11+ Level presentation;
- cross-subject locked preview behaviour;
- shared canonical Maths Year/Level aliases;
- English normal versus English 11+ presentation;
- VR visibility for 11+ English only;
- ScreenPal quiz visibility in 11+ presentation only;
- protected Answer Pack password flow;
- Year 4 11+ Maths prior Level 1 full-library continuity;
- Year 5 11+ Maths prior Level 2 full-library continuity.

The Phase 11 guarded Cloudflare apply must seed these records only into the isolated V2 development `STUDENTS_KV`, add their normalised IDs to `DEV_LOGIN_ALLOWLIST`, and must not enable normal production student login.
