# Live curriculum navigation authority fix — 2026-09-08

Production diagnostic for Dharm (`dha2806`) proved that student entitlements were correct but navigation curriculum membership had drifted:

- live `LESSONS_KV curriculum:MATHS_L1`: 35 lessons;
- Dharm had FULL entitlement to all 35 live L1 lesson IDs;
- bundled Phase 11 navigation `MATHS_L1`: 36 lessons;
- bundled-only IDs: `Y4M36`, `Y4M24`;
- live-only ID: `Y4M22`.

Result before fix: the home card compared entitlements against stale bundled membership and showed `34 open · 2 locked` even though Dharm had full access to the entire current live L1.

Fix: `phase11-navigation-cache.js` now treats live `LESSONS_KV` curriculum records as authoritative for curriculum membership/order on every student navigation request. The generated bundled manifest remains a fast cache for lesson navigation metadata. Missing/malformed live curriculum records retain the bundled fail-safe.

Regression coverage simulates bundled/live curriculum drift and requires the live curriculum membership to win for home, known view, lesson detail and resource navigation.
