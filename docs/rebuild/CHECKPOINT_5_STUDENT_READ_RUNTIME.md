# Portal V2 Performance Rebuild — Checkpoint 5

## Student Runtime Hot Read Path — isolated staging

Checkpoint 5 proves the replacement Student runtime can serve its high-frequency navigation reads directly from the prepared global and access read models built in Checkpoints 2–4.

The historical rebuild materials available before this checkpoint did not contain an authoritative Checkpoint 5 title or implementation contract. This checkpoint therefore takes the narrowest safe next step after the completed Checkpoint 4 compatibility period: exercise the Student read path in isolated staging without moving production student traffic.

## Scope

Implemented in the separate Student runtime only:

- `GET /health`
- `GET /read-models/status`
- `GET /api/v2/student/home`
- `GET /api/v2/student/views/{viewId}/lessons`
- `GET /api/v2/student/lessons/{lessonId}?viewId=...`
- `GET /api/v2/student/views/{viewId}/special-areas`

The runtime consumes only the isolated staging `READ_MODELS_KV` binding. It has no production `STUDENTS_KV`, `LESSONS_KV`, D1, R2 or email binding and performs no entitlement reconstruction on request.

A deterministic synthetic staging access scope is compiled and atomically published before deployment. It is not a real pupil and contains no real pupil identifier, password, email, token or session data.

## Read protocol

The Student runtime implements the same verified immutable-envelope/current-pointer protocol used by the Admin/Operations publisher, but its resolver is intentionally read-only.

Normal request cost is bounded:

- Home: access current pointer + access immutable envelope — normally 2 KV `get` operations.
- Special-area access summary: access current pointer + access immutable envelope — normally 2 KV `get` operations.
- View lesson list: global pointer/envelope plus access pointer/envelope — normally 4 KV `get` operations.
- Lesson metadata shell: global pointer/envelope plus access pointer/envelope — normally 4 KV `get` operations.

If the current immutable version cannot be verified, the resolver may read the single recorded previous version as a bounded fallback. It does not query legacy entitlement tables.

## Access semantics under test

The synthetic fixture proves:

- a current normal Year 5 Maths view;
- a previous Year 4 Maths historical view;
- a locked L2 preview;
- full lesson access;
- Online PreLesson-only access;
- blocked access overriding an otherwise granted lesson;
- locked-preview metadata without ordinary Year 5 access widening into L2;
- a synthetic special-area entitlement;
- verified previous-version fallback.

Locked catalogue items keep safe metadata but do not gain open state. Resource delivery is deliberately not part of this checkpoint; lesson detail returns a metadata/access shell with `resourcesIncluded: false`.

## Special-area boundary

The Checkpoint 5 `/special-areas` route is a bounded access-summary route. For an unlocked visible view it returns the synthetic access snapshot's special-area identifiers; for a locked preview it returns none. It does not yet implement final special-area content/bucket-to-view rendering semantics and must not be treated as that later feature.

## Explicit exclusions

Checkpoint 5 does **not**:

- repoint `lessons.futureperfect.education`;
- alter the current production Worker;
- cut production students over to the replacement runtime;
- change the production frontend;
- migrate authentication/session handling;
- provide video or PDF delivery;
- provide Answer Pack delivery/protection changes;
- perform production entitlement writes;
- bind production D1/R2/STUDENTS_KV/LESSONS_KV to the replacement Student runtime;
- replace or delete Checkpoint 4 production-shadow compatibility.

## Gate

Checkpoint 5 passes only if all of the following are true:

1. deterministic regression tests prove current/previous/preview, full, PreLesson-only, blocked and no-widening semantics;
2. atomic current/previous fallback works;
3. the Student runtime contains no direct entitlement-table or R2 hot-read path;
4. the staging deployment has only the dedicated prepared-read-model KV binding;
5. live staging Home, Year/Level, lesson and special-area routes return the expected synthetic results;
6. measured p95 total response time is below 2 seconds for each representative hot route during the controlled CI probe;
7. the exact Checkpoint 4 production Worker deployment/version is identical before and after the Checkpoint 5 run;
8. no production data mutation or production student cutover occurs.

Checkpoint 6 must not begin until this gate passes.
