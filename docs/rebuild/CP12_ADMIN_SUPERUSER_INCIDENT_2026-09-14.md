# CP12 Admin Superuser Incident — 2026-09-14

## Status

The production Admin-superuser login incident was repaired during Official Checkpoint 12. CP12 remains OPEN. CP13 has not started and remains prohibited until the documented CP12 representative operational-cycle gate is genuinely met.

## User-visible incident

Authenticated reproduction on the public portal showed:

- `POST /api/v2/auth/login`
- HTTP `503 Service Unavailable`
- response error `READ_MODEL_POINTER_UNAVAILABLE`
- `/api/v2/student/home` was not reached.

Ordinary student production login remained operational.

## Root cause

The rebuilt canonical Student runtime authenticated `admin` successfully, created the signed session, and then unconditionally attempted to resolve a per-pupil prepared access snapshot. Admin is an immutable superuser identity and intentionally has no pupil access pointer, so login failed while resolving `access:<scope>`.

The defect was an omission of Admin-principal/full-library semantics in the rebuilt canonical public runtime. It was not a Browser routing defect and it did not require Browser→AdminOps routing, a legacy wrapper, or a parallel runtime.

## Canonical repair

The direct repair is confined to the canonical Student runtime:

- derive the immutable Admin principal from signed session subject `admin` without an additional datastore read;
- Admin login no longer resolves a pupil access snapshot;
- Admin Home, subject, view and lesson authorization use the existing prepared global read model and prepared lesson detail models;
- ordinary students continue to use the existing compiled access snapshot path;
- protected Answer Packs retain live password validation, rate limiting and scoped capability delivery;
- the VR How-To decorator does not perform a pupil-access lookup for Admin.

No Browser→AdminOps service binding was added. No new Student hot-path D1/KV read, persistence write, retry, synchronization step or fallback runtime was added.

## Validation before production

The repair was validated on `incident/cp12-admin-principal-2026-09-14` with dedicated Admin-principal tests plus the existing CP2/CP5/CP6 authentication, capability, prepared-read-model and canonical-runtime regression gates.

A production-shaped isolated shadow was deployed. The accepted frontend build remained `a4513da67ee66f51212114620c8e401bd5e31a8c`. The owner manually confirmed Admin login, Home, Maths/English navigation, Year 6 and a representative lesson all worked on the shadow.

The exact production candidate was also authenticated through a Cloudflare Version Preview URL before promotion.

## Production promotion

The live topology was reverified immediately before mutation:

- public route: `lessons.futureperfect.education/*` → `fpt-portal-v2-rebuild-browser-prod`;
- Browser service binding `STAGING_API` → `fpt-portal-v2-rebuild-student-prod`;
- Browser has no AdminOps service binding;
- Student Worker uses the established READ_MODELS_KV, STUDENTS_KV, D1 and MATERIALS_R2 bindings and retained auth/scope secrets.

The repaired Student Worker version was promoted with automatic rollback guards:

- previous/rollback version: `0751feed-5aa3-40fb-854f-5847c8603872`;
- repaired active version: `bed8e660-facb-47f3-afad-7a9996d95c5a`.

Controlled production-promotion workflow run: `34841674266` — PASS.

Post-promotion public authenticated timings from that run:

- Admin login `374.067 ms`; Home `189.739 ms`; combined `563.806 ms`;
- representative student login `139.621 ms`; Home `142.945 ms`; combined `282.566 ms`.

Both remain below the CP10 `<1500 ms` login/bootstrap threshold. The Browser deployment was unchanged and the rollback Student version was retained.

## Post-repair CP12 observer

Full post-repair observer run `34842163362` — PASS.

Evidence artifact:

- artifact ID `10346995743`;
- name `cp12-admin-postrepair-readonly-observer-evidence`;
- SHA-256 `4f0e920fbeb23df990df5b66fb41d3bc4bf83b4d5facbd453aa35a6ab56e81b1`.

Observer results included:

- 372 canonical lessons;
- 15 presentation catalogues;
- 0 resource mismatches;
- 23 current students audited;
- 0 unexplained access differences;
- VR How-To: manual `3`, direct `0`;
- public Admin login/Home/Maths/year-or-level/lesson smoke PASS;
- representative student login/Home/navigation smoke PASS;
- no Browser→AdminOps routing;
- no legacy phase runtime, D1 session lookup, activity write or R2 HEAD fanout reintroduced;
- retained Admin lesson-release/import implementation static and fail-closed continuity checks PASS, with no import applied.

Observer authenticated timings:

- Admin login `387.976 ms`; Home `362.309 ms`; combined `750.285 ms`;
- representative student login `360.538 ms`; Home `87.584 ms`; combined `448.122 ms`.

## Remaining CP12 gate

No genuine normal post-cutover release/import operational cycle has yet been observed after the rebuild cutover. The post-repair read-only detector still reports zero qualifying full-release rows and zero qualifying online-PreLesson rows after cutover.

Therefore:

- `representativeCycleGateMet = false`;
- CP12 remains OPEN;
- CP13 remains prohibited;
- no synthetic pupil/release cycle is to be created merely to satisfy the gate.

When the next genuine normal release/import cycle occurs, run the normal CP12 operational-cycle detector and the full read-only observer. CP12 may close only if that genuine cycle and all remaining documented stabilisation gates pass.
