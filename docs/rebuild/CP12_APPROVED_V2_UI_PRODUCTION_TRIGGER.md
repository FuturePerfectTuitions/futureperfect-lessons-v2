# CP12 approved V2 UI production promotion trigger — attempt 2

Second guarded promotion authority created only after the first attempt failed safely during immediate KV read-after-write verification, the production Worker versions remained/restored to their original anchors, and an independent read-only audit proved all 369 prepared pointers exactly matched the pre-attempt backup.

Immediately before this second trigger, the mandated authority was re-read from the original CP12 handover:
- `authority/SAFE_IMPLEMENTATION_PLAN_AND_GATES.md`
- `authority/APPROVED_ARCHITECTURE_DECISIONS_1_TO_33.md`
- `PERFORMANCE_FIX_DISCIPLINE.md`
- `CANONICAL_RUNTIME_ARCHITECTURE_RULE.md`

Frozen authorities for attempt 2:
- Official CP12: `b5e38b3768d269f632bbf4fc95e7d3f2a3fb3ba2`
- Approved fast frontend: `598ec347ffddb126889f95d6a7753539e0ed3c97`
- Presentation metadata source: `9793028e34b16972defa64d3e465db907868e645`
- Staging browser UAT: `34931616127` — SUCCESS
- First promotion attempt: `34932834264` — FAILED before Student/Browser traffic promotion during metadata verification
- Post-failure exact 369-pointer/runtime restoration audit: `34933937628` — SUCCESS
- Convergence-safe metadata helper isolated full apply + full rollback test: `34934090090` — SUCCESS
- Second-attempt production preflight v3: `34934456421` — SUCCESS
- Promotion workflow blob: `fdd3947fc50735360a7f1501e98b05e76f163cbe`
- Exact convergence-safe metadata helper blob: `4cda45292706942a0e9f6b3c701a71c2a55c7d91`
- Exact authenticated smoke helper blob: `f153d85176e813d8507d03c9c59b6a5ebccfcf62`

The promotion workflow must fail closed and perform bounded exact-value verification for metadata apply/rollback. Any Browser, Student, metadata, topology, security or rollback verification error must prevent a PASS. This trigger authorizes CP12 production promotion attempt 2 only; it does not authorize CP13.
