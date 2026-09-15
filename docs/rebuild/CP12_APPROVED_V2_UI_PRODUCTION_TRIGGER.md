# CP12 approved V2 UI production promotion trigger — attempt 4

This fourth guarded promotion is authorized after the prior promotion failures were proved to be harness/verification defects and their automatic rollback paths restored the exact production baseline. The fast rebuilt runtime remains the runtime authority; this promotion restores the approved Portal V2 presentation/UX without reintroducing the old slow execution architecture.

Immediately before this production mutation, the mandatory authority was re-read from the original CP12 handover:
- `authority/SAFE_IMPLEMENTATION_PLAN_AND_GATES.md`
- `authority/APPROVED_ARCHITECTURE_DECISIONS_1_TO_33.md`
- `PERFORMANCE_FIX_DISCIPLINE.md`
- `CANONICAL_RUNTIME_ARCHITECTURE_RULE.md`
- `07_PORTAL_V2_FRONTEND_PARITY_RESTORATION.md`
- `08_ENTITLEMENT_POPULATION_AUDIT.md`
- `09_UI_PROMOTION_ATTEMPT_AND_ROLLBACK.md`

Fresh authority immediately before mutation:
- Official CP12 branch is exactly `b5e38b3768d269f632bbf4fc95e7d3f2a3fb3ba2` with parent `766e9dd099edfc4bfed429ca7de1aa97ac7e4509`.
- Approved fast frontend is exactly `598ec347ffddb126889f95d6a7753539e0ed3c97`.
- Presentation metadata source is exactly `9793028e34b16972defa64d3e465db907868e645`.
- Metadata helper blob is `4cda45292706942a0e9f6b3c701a71c2a55c7d91`.
- Production browser UAT blob is `df0e5e9c1b5e2a8099985be98974c5b54f5e5b17`; it fail-closes on Admin and auto-discovers distinct real ordinary and 11+ student principals via protected read-only production data.
- Real-persona prerequisite blob is `fae56dc89964fdaa8c6992fb2098b94012f9da7c`.
- Guarded production-promotion workflow blob remains `22da830eb1f84b1e8f9e8c06e5a675e865cdb35a`.
- Staging full browser UAT `34931616127` — SUCCESS.
- Corrected real-persona prerequisite — SUCCESS.
- Production UAT real-persona source validation `34939724378` — SUCCESS.
- Final read-only production preflight v5b `34940026469` — SUCCESS. It freshly proved exact CP12 sources, canonical Browser→Student-only topology, expected production versions/bindings, rollback retention, distinct real ordinary and 11+ Y5E2 student principals, and a no-write prepared metadata preview of 372 published lesson scopes / 369 presentation-only changes / 3 unchanged scopes / 1,509 resources / zero non-presentation drift.

The production workflow remains fail-closed and automatically restores Browser, Student and prepared pointers on any failed promotion/UAT gate. This authorizes CP12 production promotion only. It does not authorize CP13.
