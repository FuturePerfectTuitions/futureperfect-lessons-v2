# Rebuilt Trial Manager production trigger

Date: 2026-09-17

Purpose: trigger the guarded production deployment and live acceptance test for the rebuilt Trial Login Manager implementation on `feature/rebuilt-trial-manager-2026-09-17`.

The deployment workflow must preserve the Browser -> Student public topology, preserve all live Worker bindings/secrets, deploy the operational Admin API and rebuilt Student Trial runtime, publish prepared access for TrialSej and TrialEva, perform a real one-login TrialSej smoke including Year 4 11+ VR visibility, block the second login, and re-arm TrialSej after the test.
