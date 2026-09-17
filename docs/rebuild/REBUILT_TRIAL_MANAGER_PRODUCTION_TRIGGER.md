# Rebuilt Trial Manager production trigger

Date: 2026-09-17
Retry: 3

Purpose: trigger the guarded production deployment and live acceptance test for the rebuilt Trial Login Manager implementation on `feature/rebuilt-trial-manager-2026-09-17`.

The deployment workflow must preserve the Browser -> Student public topology, preserve all live Worker bindings/secrets, add exactly one operational Admin binding when absent (`REBUILD_SHADOW_KV` pointing to the live Student `READ_MODELS_KV` namespace), deploy the operational Admin API and rebuilt Student Trial runtime, publish prepared access for TrialSej and TrialEva, perform a real one-login TrialSej smoke including Year 4 11+ VR visibility, block the second login, and return TrialSej to the unused state after the test.

No student or Admin passwords may be printed or persisted in deployment evidence.
