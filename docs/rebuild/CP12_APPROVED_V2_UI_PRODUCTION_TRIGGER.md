# CP12 approved V2 UI production promotion trigger — attempt 3

This third guarded promotion is authorized only after both earlier failures were proved to be harness/verification defects rather than accepted product regressions, and both rollback paths restored the production baseline.

Immediately before this trigger, the mandatory authority was re-read from the original CP12 handover:
- `authority/SAFE_IMPLEMENTATION_PLAN_AND_GATES.md`
- `authority/APPROVED_ARCHITECTURE_DECISIONS_1_TO_33.md`
- `PERFORMANCE_FIX_DISCIPLINE.md`
- `CANONICAL_RUNTIME_ARCHITECTURE_RULE.md`

Fresh authority immediately before mutation:
- Official CP12 branch remains exactly `b5e38b3768d269f632bbf4fc95e7d3f2a3fb3ba2`.
- Approved fast frontend remains exactly `598ec347ffddb126889f95d6a7753539e0ed3c97`.
- Presentation metadata source remains exactly `9793028e34b16972defa64d3e465db907868e645`.
- Convergence-safe metadata helper blob: `4cda45292706942a0e9f6b3c701a71c2a55c7d91`.
- Direct production browser UAT blob: `e1780160f4635006d804f0ebd072ad73aa45fb36`.
- Corrected guarded production-promotion workflow blob: `22da830eb1f84b1e8f9e8c06e5a675e865cdb35a`.
- Staging full browser UAT `34931616127` — SUCCESS.
- Post-first-failure exact 369-pointer/runtime restoration audit `34933937628` — SUCCESS.
- Isolated eventual-consistency apply+rollback test `34934090090` — SUCCESS.
- Production Admin/view prerequisite `34935668663` — SUCCESS.
- Final read-only production preflight v4c `34936463539` — SUCCESS; production baseline/topology fresh and metadata preview proved 372 published scopes, 369 presentation-only changes, 3 unchanged, 1,509 resources and zero non-presentation drift.

Failure history resolved before this trigger:
- Attempt 1 (`34932834264`) stopped during immediate KV read-after-write verification before Student/Browser traffic promotion. Independent convergence audit proved restoration.
- Attempt 2 (`34934878943`) reached the candidate runtime but the production UAT did not execute because a temporary embedded Python source transformer had a quoting syntax error. Automatic rollback restored Browser, Student and all 369 prepared pointers. The transformer has been removed; the production workflow now executes the separately parsed direct UAT source.

The production workflow remains fail-closed. Any metadata, Student, Browser, topology, security, visual/functional UAT or rollback-verification failure prevents PASS and invokes the guarded rollback path. This authorizes CP12 production promotion only. It does not authorize CP13.
